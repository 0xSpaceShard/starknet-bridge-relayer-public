import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from 'common/config';
import { Web3Service } from 'web3/web3.service';
import {
  CheckCanProcessWithdrawalsResults,
  ProcessWithdrawalsResults,
  RequestWithdrawalAtBlocks,
} from './relayer.interface';
import { MulticallRequest, MulticallResponse } from 'web3/web3.interface';
import { ZeroBytes, l2BridgeAddressToL1 } from './relayer.constants';
import { MongoService } from 'storage/mongo/mongo.service';
import { Transfer, Withdrawal } from 'indexer/entities';
import { IndexerService } from 'indexer/indexer.service';
import { callWithRetry, sleep } from './relayer.utils';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { PrometheusService } from 'common/prometheus';
import { getMessageHash } from './utils';
import { ethers, BigNumber } from 'ethers';

@Injectable()
export class RelayerService {
  sleepAfterSuccessExec: number;
  sleepAfterFailExec: number;
  chunk: number;
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
  ) {
    this.sleepAfterSuccessExec = Number(this.configService.get('RELAYER_SLEEP_AFTER_SUCCESS_EXEC'));
    this.sleepAfterFailExec = Number(this.configService.get('RELAYER_SLEEP_AFTER_FAIL_EXEC'));
    this.chunk = Number(this.configService.get('NUMBER_OF_BLOCKS_TO_PROCESS_PER_CHUNK'));
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
        this.logger.error(`Error process withdrawals, sleep ${this.sleepAfterSuccessExec} MS`, { error });
        await sleep(this.sleepAfterFailExec);
        continue;
      }
      this.logger.log(`Relayer sleep ${this.sleepAfterSuccessExec} MS`);
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
        const allMulticallRequests: Array<MulticallRequest> = this.getMulticallRequests(
          requestWithdrawalAtBlocks.withdrawals,
        );
        // Check which message hashs exists on L1.
        const viewMulticallResponse: Array<MulticallResponse> = await this.getListOfL2ToL1MessagesResult(
          allMulticallRequests,
          250,
        );
        // Filter the valid messages that can be consumed on L1.
        const allMulticallRequestsForMessagesCanBeConsumedOnL1 = this.getListOfValidMessagesToConsumedOnL1(
          requestWithdrawalAtBlocks.withdrawals,
          viewMulticallResponse,
          allMulticallRequests,
        );
        // Consume the messages.
        if (allMulticallRequestsForMessagesCanBeConsumedOnL1.length > 0) {
          await this.consumeMessagesOnL1(allMulticallRequestsForMessagesCanBeConsumedOnL1);
        }
        // Store the last processed block on database.
        await this.updateProcessedBlock(currentToBlockNumber);
        // Update stats.
        totalWithdrawalsProcessed += allMulticallRequestsForMessagesCanBeConsumedOnL1.length;
        totalWithdrawals += allMulticallRequests.length;
      }
    }
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

  getMulticallRequests(withdrawals: Array<Withdrawal>): Array<MulticallRequest> {
    const multicallRequests: Array<MulticallRequest> = [];
    const l2BridgeAddressToL1Addresses = l2BridgeAddressToL1(this.networkId);

    for (let i = 0; i < withdrawals.length; i++) {
      const withdrawal = withdrawals[i];
      const l1BridgeAddress = l2BridgeAddressToL1Addresses[withdrawal.bridgeAddress].l1BridgeAddress;

      if (
        l1BridgeAddress &&
        (this.checkIfUserPaiedTheRelayer(withdrawal.transfers) || this.configService.get('TRUSTED_MODE') == 'true')
      ) {
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

  async consumeMessagesOnL1(multicallRequest: Array<MulticallRequest>) {
    await this.callWithRetry({
      callback: async () => {
        const tx = await this.web3Service.callWithdrawMulticall(multicallRequest);
        this.logger.log('Consume messages tx', { txHash: tx.hash });
        this.prometheusService.web3ConsumeMessageRequests
          .labels({ method: 'callWithdrawMulticall', txHash: tx.hash })
          .inc();
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

  private async _getListOfL2ToL1MessagesResult(
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

  checkIfUserPaiedTheRelayer(transfers: Transfer[]): boolean {
    let paied: boolean = false;
    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i];
      if (transfer.to == this.relayerAddress) {
        paied = true;
        break;
      }
    }
    return paied;
  }

  async callWithRetry({ callback, errorCallback }: { callback: Function; errorCallback: Function }) {
    return await callWithRetry(3, 2000, callback, errorCallback);
  }
}
