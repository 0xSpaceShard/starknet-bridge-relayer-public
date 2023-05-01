import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from 'common/config';
import { Web3Service } from 'web3/web3.service';
import {
  CheckCanProcessWithdrawalsResults,
  ProcessWithdrawalsResults,
  RequestWithdrawalAtBlocks,
} from './relayer.interface';
import { MulticallRequest, MulticallResponse } from 'web3/web3.interface';
import {
  NumberOfMessageToProcessPerTransaction,
  NumberOfWithdrawalsToProcessPerTransaction,
  ZeroBytes,
  l2BridgeAddressToL1,
} from './relayer.constants';
import { MongoService } from 'storage/mongo/mongo.service';
import { Transfer, Withdrawal } from 'indexer/entities';
import { IndexerService } from 'indexer/indexer.service';
import { callWithRetry, getMessageHash, sleep } from './relayer.utils';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { PrometheusService } from 'common/prometheus';
import { ethers, BigNumber } from 'ethers';
import { GasService } from 'http/gas/gas.service';
import { CheckPointSizeMs } from 'http/gas/gas.constants';

@Injectable()
export class RelayerService {
  sleepAfterSuccessExec: number = 300000;
  sleepAfterFailExec: number = 60000;
  chunk: number = 50;
  networkId: string;
  relayerAddress: string;
  firstBlock: number;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private configService: ConfigService,
    private web3Service: Web3Service,
    private mongoService: MongoService,
    private indexerService: IndexerService,
    private readonly prometheusService: PrometheusService,
    private readonly gasService: GasService,
  ) {
    this.networkId = this.configService.get('NETWORK_ID');
    this.relayerAddress = this.configService.get('RELAYER_L2_ADDRESS');
    this.firstBlock = Number(this.configService.get('FIRST_BLOCK'));
  }

  async run() {
    while (true) {
      try {
        const { fromBlock, toBlock, stateBlockNumber } = await this.canProcessWithdrawals();
        if (fromBlock < toBlock) {
          const res = await this.processWithdrawals(fromBlock, toBlock, stateBlockNumber);
          this.logger.log('Success process withdrawals:', res);
        } else {
          this.logger.log('Nothing to process.');
        }
      } catch (error: any) {
        this.logger.error(`Error process withdrawals, sleep ${this.sleepAfterSuccessExec / 1000} sec`, { error });
        await sleep(this.sleepAfterFailExec);
        continue;
      }
      this.logger.log(`Relayer sleep ${this.sleepAfterSuccessExec / 1000} sec`);
      await sleep(this.sleepAfterSuccessExec);
    }
  }

  async processWithdrawals(
    fromBlock: number,
    toBlock: number,
    stateBlockNumber: number,
  ): Promise<ProcessWithdrawalsResults> {
    let currentFromBlockNumber = fromBlock;
    let currentToBlockNumber = fromBlock;
    let totalWithdrawalsProcessed = 0;
    let totalWithdrawals = 0;

    const allMulticallRequestsForMessagesCanBeConsumedOnL1 = [];

    // Start processed withdrawals between 2 blocks.
    while (currentToBlockNumber !== toBlock) {
      // Update the block numbers.
      currentFromBlockNumber = currentToBlockNumber;

      if (currentToBlockNumber + this.chunk > toBlock && currentToBlockNumber != toBlock) {
        currentToBlockNumber = toBlock;
      } else {
        currentToBlockNumber += this.chunk;
      }

      // Update the block numbers.
      this.logger.log('Process transactions between blocks', { currentFromBlockNumber, currentToBlockNumber });

      // Get Withdrawals from the indexer
      const requestWithdrawalAtBlocks = await this.getRequestWithdrawalAtBlocks(
        currentFromBlockNumber + 1,
        currentToBlockNumber,
      );

      if (requestWithdrawalAtBlocks.withdrawals.length > 0) {
        // Prepare multicallRequest data to check if the withdrawals can be consumed on L1
        const allMulticallRequests: Array<MulticallRequest> = await this.getMulticallRequests(
          requestWithdrawalAtBlocks.withdrawals,
        );

        // Check which message hashs exists on L1.
        const viewMulticallResponse: Array<MulticallResponse> = await this.getListOfL2ToL1MessagesResult(
          allMulticallRequests,
          NumberOfMessageToProcessPerTransaction,
        );
        // Filter the valid messages that can be consumed on L1.
        allMulticallRequestsForMessagesCanBeConsumedOnL1.push(
          ...this.getListOfValidMessagesToConsumedOnL1(
            requestWithdrawalAtBlocks.withdrawals,
            viewMulticallResponse,
            allMulticallRequests,
          ),
        );
        totalWithdrawals += requestWithdrawalAtBlocks.withdrawals.length;
      }
    }

    totalWithdrawalsProcessed = allMulticallRequestsForMessagesCanBeConsumedOnL1.length;

    // Consume the messages.
    if (allMulticallRequestsForMessagesCanBeConsumedOnL1.length > 0) {
      await this.consumeMessagesOnL1(
        allMulticallRequestsForMessagesCanBeConsumedOnL1,
        NumberOfWithdrawalsToProcessPerTransaction,
      );
    }
    // Store the last processed block on database.
    await this.updateProcessedBlock(currentToBlockNumber);

    return {
      currentFromBlockNumber,
      currentToBlockNumber,
      stateBlockNumber,
      totalWithdrawalsProcessed,
      totalWithdrawals,
    };
  }

  async getLastProcessedBlock(): Promise<number> {
    return await this.callWithRetry({
      callback: async () => {
        let lastProcessedBlockNumber = (await this.mongoService.getLastProcessedBlock()).blockNumber;
        if (!lastProcessedBlockNumber) {
          await this.updateProcessedBlock(this.firstBlock);
          lastProcessedBlockNumber = this.firstBlock;
        }
        this.logger.log('Get last processed block number', { lastProcessedBlockNumber });
        this.prometheusService.storageRequests.labels({ method: 'getLastProcessedBlock-updateProcessedBlock' }).inc();
        return lastProcessedBlockNumber;
      },
      errorCallback: (error: any) => {
        const errMessage = `Error to get last processed block number: ${error}`;
        this.logger.error(errMessage);
        this.prometheusService.storageErrors.labels({ method: 'getLastProcessedBlock-updateProcessedBlock' }).inc();
        throw errMessage;
      },
    });
  }

  async getRequestWithdrawalAtBlocks(fromBlock: number, endBlock: number): Promise<RequestWithdrawalAtBlocks> {
    const limit = 1000;
    let index = 0;

    const listRequestWithdrawalsAtBlocks: RequestWithdrawalAtBlocks = {
      fromBlock,
      toBlock: endBlock,
      withdrawals: [],
    };

    while (true) {
      const offset = limit * index;
      const withdrawals: Array<Withdrawal> = await this.callWithRetry({
        callback: async () => {
          const withdrawals = await this.indexerService.getWithdraws(limit, offset, fromBlock, endBlock);
          this.logger.log('List the withdrawals', { fromBlock, endBlock, withdrawalsLength: withdrawals.length });
          this.prometheusService.indexerRequests.labels({ method: 'getWithdraws' }).inc();
          return withdrawals;
        },
        errorCallback: (error: any) => {
          const errMessage = `Error List the withdrawals: ${error}`;
          this.logger.error(errMessage);
          this.prometheusService.indexerErrors.labels({ method: 'getWithdraws' }).inc();
          throw errMessage;
        },
      });

      if (withdrawals.length === 0) {
        break;
      }

      listRequestWithdrawalsAtBlocks.withdrawals.push(...withdrawals);

      if (withdrawals.length < limit) {
        break;
      }
      index++;
    }
    return listRequestWithdrawalsAtBlocks;
  }

  async getMulticallRequests(withdrawals: Array<Withdrawal>): Promise<Array<MulticallRequest>> {
    const multicallRequests: Array<MulticallRequest> = [];
    const l2BridgeAddressToL1Addresses = l2BridgeAddressToL1(this.networkId);

    for (let i = 0; i < withdrawals.length; i++) {
      const withdrawal = withdrawals[i];
      const l1BridgeAddress = l2BridgeAddressToL1Addresses[withdrawal.bridgeAddress].l1BridgeAddress;

      if (l1BridgeAddress && (await this.checkIfAmountPaidIsValid(withdrawal))) {
        multicallRequests.push({
          target: this.web3Service.getAddresses().starknetCore,
          callData: this.web3Service.encodeCalldataStarknetCore('l2ToL1Messages', [
            getMessageHash(withdrawal.bridgeAddress, l1BridgeAddress, withdrawal.l1Recipient, withdrawal.amount),
          ]),
        });
      }
    }
    return multicallRequests;
  }

  getListOfValidMessagesToConsumedOnL1(
    withdrawals: Array<Withdrawal>,
    multicallResponse: Array<MulticallResponse>,
    allMulticallRequest: Array<MulticallRequest>,
  ): Array<MulticallRequest> {
    const multicallRequests: Array<MulticallRequest> = [];
    const l2BridgeAddressToL1Addresses = l2BridgeAddressToL1(this.networkId);

    // Cache the response to avoid duplicate hashes.
    const cache = {};
    for (let i = 0; i < multicallResponse.length; i++) {
      cache[allMulticallRequest[i].callData] = BigNumber.from(multicallResponse[i].returnData).toNumber();
    }

    for (let i = 0; i < multicallResponse.length; i++) {
      const txReturnData = multicallResponse[i].returnData;

      // If the `txReturnData` is ZERO it means the messages was already consumed.
      if (txReturnData == ZeroBytes) continue;
      if (cache[allMulticallRequest[i].callData] - 1 < 0) continue;
      cache[allMulticallRequest[i].callData] -= 1;

      const withdrawal = withdrawals[i];
      const target = l2BridgeAddressToL1Addresses[withdrawal.bridgeAddress].l1BridgeAddress;

      const l1RecipientDecoded = ethers.utils.defaultAbiCoder.decode(['address'], withdrawal.l1Recipient)[0];
      multicallRequests.push({
        target,
        callData: this.web3Service.encodeBridgeToken('withdraw', [withdrawal.amount, l1RecipientDecoded]),
      });
    }
    return multicallRequests;
  }

  async consumeMessagesOnL1(multicallRequest: Array<MulticallRequest>, limit: number): Promise<number> {
    const lenght = Math.ceil(multicallRequest.length / limit);
    for (let i = 0; i < lenght; i++) {
      const from = i * limit;
      const to = Math.min((i + 1) * limit, multicallRequest.length);
      const multicallRequests = multicallRequest.slice(from, to);
      const tx = await this._consumeMessagesOnL1(multicallRequests);
      await tx.wait();
    }
    return lenght;
  }

  async _consumeMessagesOnL1(multicallRequest: Array<MulticallRequest>): Promise<ethers.ContractTransaction> {
    return await this.callWithRetry({
      callback: async () => {
        const tx = await this.web3Service.callWithdrawMulticall(multicallRequest);
        this.logger.log('Consume messages tx', { txHash: tx.hash, withdrawals: multicallRequest.length });
        this.prometheusService.web3ConsumeMessageRequests
          .labels({ method: 'callWithdrawMulticall', txHash: tx.hash })
          .inc();
        return tx;
      },
      errorCallback: (error: any) => {
        const errMessage = `Error to consume messagess: ${error}`;
        this.logger.error(errMessage);
        this.prometheusService.web3Errors.labels({ method: 'callWithdrawMulticall' }).inc();
        throw errMessage;
      },
    });
  }

  async updateProcessedBlock(toBlock: number) {
    return await this.callWithRetry({
      callback: async () => {
        await this.mongoService.updateProcessedBlock(toBlock);
        this.logger.log('Update processed block', { toBlock });
        this.prometheusService.storageRequests.labels({ method: 'updateProcessedBlock' }).inc();
      },
      errorCallback: (error: any) => {
        const errMessage = `Error to update processed block: ${error}`;
        this.logger.error(errMessage);
        this.prometheusService.storageErrors.labels({ method: 'updateProcessedBlock' }).inc();
        throw errMessage;
      },
    });
  }

  async getListOfL2ToL1MessagesResult(
    allMulticallRequests: Array<MulticallRequest>,
    limit: number,
  ): Promise<Array<MulticallResponse>> {
    const lenght = Math.ceil(allMulticallRequests.length / limit);
    const multicallResponses: Array<MulticallResponse> = [];
    for (let i = 0; i < lenght; i++) {
      const from = i * limit;
      const to = Math.min((i + 1) * limit, allMulticallRequests.length);
      const multicallRequests = allMulticallRequests.slice(from, to);
      const res = await this._getListOfL2ToL1MessagesResult(multicallRequests);
      multicallResponses.push(...res);
    }
    return multicallResponses;
  }

  async _getListOfL2ToL1MessagesResult(
    allMulticallRequests: Array<MulticallRequest>,
  ): Promise<Array<MulticallResponse>> {
    return await this.callWithRetry({
      callback: async () => {
        const res = await this.web3Service.canConsumeMessageOnL1MulticallView(allMulticallRequests);
        this.logger.log('Check can consume message on L1 multicall view', { requestsNum: allMulticallRequests.length });
        this.prometheusService.web3Requests.labels({ method: 'canConsumeMessageOnL1MulticallView' }).inc();
        return res;
      },
      errorCallback: (error: any) => {
        const errMessage = `Error to check messages can be consumed on L1 multicall view: ${error}`;
        this.logger.error(errMessage);
        this.prometheusService.web3Errors.labels({ method: 'canConsumeMessageOnL1MulticallView' }).inc();
        throw errMessage;
      },
    });
  }

  async canProcessWithdrawals(): Promise<CheckCanProcessWithdrawalsResults> {
    return await this.callWithRetry({
      callback: async () => {
        let lastProcessedBlockNumber = await this.getLastProcessedBlock();
        let lastIndexedBlock = await this.indexerService.getLastIndexedBlock();
        const stateBlockNumber = (await this.web3Service.getStateBlockNumber()).toNumber();

        lastIndexedBlock = lastIndexedBlock !== undefined ? lastIndexedBlock : lastProcessedBlockNumber;
        const toBlock = Math.min(lastIndexedBlock, stateBlockNumber);
        const fromBlock = Math.min(lastProcessedBlockNumber, toBlock);

        this.logger.log('Check can process withdrawals', {
          fromBlock,
          toBlock,
          stateBlockNumber,
        });

        return {
          fromBlock,
          toBlock,
          stateBlockNumber,
        };
      },
      errorCallback: (error: any) => {
        const errMessage = `Error check can process withdrawals: ${error}`;
        this.logger.error(errMessage);
        throw errMessage;
      },
    });
  }

  async callWithRetry({ callback, errorCallback }: { callback: Function; errorCallback: Function }) {
    return await callWithRetry(3, 2000, callback, errorCallback);
  }

  async checkIfAmountPaidIsValid(withdrawal: Withdrawal): Promise<boolean> {
    let amountPaid: BigNumber = BigNumber.from('0');
    for (let i = 0; i < withdrawal.transfers.length; i++) {
      const transfer = withdrawal.transfers[i];
      if (transfer.to === this.relayerAddress) {
        amountPaid = BigNumber.from(transfer.value);
        break;
      }
    }

    if (amountPaid.eq(0)) {
      return false;
    }

    let timestamp = new Date(withdrawal.timestamp).getTime() / 1000;

    const validationAttempts = 2;
    for (let i = 0; i < validationAttempts; i++) {
      try {
        const gasCost = await this.gasService.getGasCostPerTimestamp(timestamp);
        if (amountPaid.gte(gasCost)) {
          return true;
        }
      } catch (error: any) {
        this.logger.error(error.toString());
        throw error;
      }
      timestamp -= CheckPointSizeMs;
    }
    return false;
  }
}
