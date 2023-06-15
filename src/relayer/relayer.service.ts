import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from 'common/config';
import { Web3Service } from 'web3/web3.service';
import {
  CheckCanProcessWithdrawalsResults,
  ProcessWithdrawalsResults,
  RelayerBalances,
  RequestWithdrawalAtBlocks,
} from './relayer.interface';
import { MulticallRequest, MulticallResponse } from 'web3/web3.interface';
import {
  MinimumEthBalance,
  NumberOfMessageToProcessPerTransaction,
  NumberOfWithdrawalsToProcessPerTransaction,
  ZeroBytes,
} from './relayer.constants';
import { MongoService } from 'storage/mongo/mongo.service';
import { Withdrawal } from 'indexer/entities';
import { IndexerService } from 'indexer/indexer.service';
import { callWithRetry, formatBalance, formatDecimals, getMessageHash, sleep } from './relayer.utils';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { PrometheusService } from 'common/prometheus';
import { ethers, BigNumber } from 'ethers';
import { GasService } from 'http/gas/gas.service';
import { CheckPointSizeMs } from 'http/gas/gas.constants';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { RelayerNotifications } from './notification/notifications';
import { DiscordService } from 'notification/discord/discord.service';
import { NetworkConfig, getNetworkConfig } from './configs';
import { NetworkFeesMetadata } from './fees';
import { ListBridgeMetadata } from 'utils/interfaces';
import { networkListBridgeMetadata } from 'utils/bridgeTokens';

@Injectable()
export class RelayerService {
  networkConfig: NetworkConfig;
  networkId: string;
  relayerAddress: string;
  firstBlock: number;
  networkFeesMetadata: NetworkFeesMetadata;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private configService: ConfigService,
    private web3Service: Web3Service,
    private mongoService: MongoService,
    private indexerService: IndexerService,
    private readonly prometheusService: PrometheusService,
    private readonly gasService: GasService,
    private readonly discordService: DiscordService,
  ) {
    this.networkId = this.configService.get('NETWORK_ID');
    this.relayerAddress = this.configService.get('RELAYER_L2_ADDRESS');
    this.firstBlock = Number(this.configService.get('FIRST_BLOCK'));
    this.networkConfig = getNetworkConfig(this.networkId);
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
        this.logger.log(`Relayer sleep ${this.networkConfig.sleepAfterSuccessExec / 1000} sec`);
        await sleep(this.networkConfig.sleepAfterSuccessExec);
        await this.canWakeupRelayer(stateBlockNumber, 300000, 600000);
      } catch (error: any) {
        this.logger.error(`Error process withdrawals, sleep ${this.networkConfig.sleepAfterFailExec / 1000} sec`, {
          error,
        });
        await sleep(this.networkConfig.sleepAfterFailExec);
        continue;
      }
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
    let totalGasPaid: BigNumber = BigNumber.from('0');
    let totalGasToUse: BigNumber = BigNumber.from('0');

    // Start processed withdrawals between 2 blocks.
    while (currentToBlockNumber !== toBlock) {
      // Update the block numbers.
      currentFromBlockNumber = currentToBlockNumber;

      if (currentToBlockNumber + this.networkConfig.chunk > toBlock && currentToBlockNumber != toBlock) {
        currentToBlockNumber = toBlock;
      } else {
        currentToBlockNumber += this.networkConfig.chunk;
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
        const {
          multicallRequests: allMulticallRequests,
          totalPaid,
          totalGas,
        } = await this.getMulticallRequests(requestWithdrawalAtBlocks.withdrawals);
        totalGasPaid = totalGasPaid.add(totalPaid);
        totalGasToUse = totalGasToUse.add(totalGas);

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
    const { status, networkCost } = await this.checkIfGasCostCoverTheTransaction(
      totalGasPaid,
      totalGasToUse,
      totalWithdrawalsProcessed,
    );

    // Consume the messages.
    if (allMulticallRequestsForMessagesCanBeConsumedOnL1.length > 0 && status) {
      await this.consumeMessagesOnL1(
        totalGasPaid,
        allMulticallRequestsForMessagesCanBeConsumedOnL1,
        NumberOfWithdrawalsToProcessPerTransaction,
      );
      this.networkFeesMetadata = {};
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

  async getMulticallRequests(
    withdrawals: Array<Withdrawal>,
  ): Promise<{ multicallRequests: Array<MulticallRequest>; totalPaid: BigNumber; totalGas: BigNumber }> {
    let totalPaid: BigNumber = BigNumber.from('0');
    let totalGas: BigNumber = BigNumber.from('0');
    const multicallRequests: Array<MulticallRequest> = [];
    const listBridgeMetadata: ListBridgeMetadata = networkListBridgeMetadata(this.networkId);

    for (let i = 0; i < withdrawals.length; i++) {
      const withdrawal = withdrawals[i];
      const bridgeMetadata = listBridgeMetadata[withdrawal.bridgeAddress];
      if (!bridgeMetadata) continue;

      const { status, amount } = await this.checkIfAmountPaidIsValid(withdrawal);
      if (bridgeMetadata.l1BridgeAddress && status) {
        totalPaid = totalPaid.add(amount);
        totalGas = totalGas.add(bridgeMetadata.gas);
        multicallRequests.push({
          target: this.web3Service.getAddresses().starknetCore,
          callData: this.web3Service.encodeCalldataStarknetCore('l2ToL1Messages', [
            getMessageHash(
              withdrawal.bridgeAddress,
              bridgeMetadata.l1BridgeAddress,
              withdrawal.l1Recipient,
              withdrawal.amount,
            ),
          ]),
          gas: String(Number(bridgeMetadata.gas) + 20000),
        });
      }
    }
    return { multicallRequests, totalPaid, totalGas };
  }

  getListOfValidMessagesToConsumedOnL1(
    withdrawals: Array<Withdrawal>,
    multicallResponse: Array<MulticallResponse>,
    allMulticallRequest: Array<MulticallRequest>,
  ): Array<MulticallRequest> {
    const multicallRequests: Array<MulticallRequest> = [];
    const listBridgeMetadata = networkListBridgeMetadata(this.networkId);

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
      const bridgeMetadata = listBridgeMetadata[withdrawal.bridgeAddress];

      const l1RecipientDecoded = ethers.utils.defaultAbiCoder.decode(['address'], withdrawal.l1Recipient)[0];
      multicallRequests.push({
        target: bridgeMetadata.l1BridgeAddress,
        callData: this.web3Service.encodeBridgeToken('withdraw', [withdrawal.amount, l1RecipientDecoded]),
        gas: String(Number(bridgeMetadata.gas) + 20000),
      });
    }
    return multicallRequests;
  }

  async consumeMessagesOnL1(
    totalGasPaid: BigNumber,
    multicallRequest: Array<MulticallRequest>,
    limit: number,
  ): Promise<number> {
    this.logger.log('Start consume messages...');
    if (multicallRequest.length === 1) {
      const req = multicallRequest[0];
      const data = defaultAbiCoder.decode(['uint256', 'address'], '0x' + req.callData.slice(10));
      const tx = await this.web3Service.callWithdraw(req.target, data[0], data[1], Number(req.gas));
      this.logger.log('Call withdraw');
      await tx.wait();
      const { l1Balance, l2Balance } = await this.getRelayerBalances();

      await RelayerNotifications.emitWithdrawalsProcessed(this.discordService, this.networkId, {
        totalWithdrawals: 1,
        relayerL1Balance: l1Balance,
        relayerL2Balance: l2Balance,
        usersPaid: formatBalance(totalGasPaid),
        txHash: tx.hash,
      });
      return 1;
    } else {
      const lenght = Math.ceil(multicallRequest.length / limit);
      for (let i = 0; i < lenght; i++) {
        const from = i * limit;
        const to = Math.min((i + 1) * limit, multicallRequest.length);
        const multicallRequests = multicallRequest.slice(from, to);
        const tx = await this._consumeMessagesOnL1(multicallRequests);
        this.logger.log('Call multicall');
        await tx.wait();
        const { l1Balance, l2Balance } = await this.getRelayerBalances();

        await RelayerNotifications.emitWithdrawalsProcessed(this.discordService, this.networkId, {
          totalWithdrawals: multicallRequests.length,
          relayerL1Balance: l1Balance,
          relayerL2Balance: l2Balance,
          usersPaid: formatBalance(totalGasPaid.div(lenght)),
          txHash: tx.hash,
        });
      }
      return lenght;
    }
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

  async checkIfAmountPaidIsValid(withdrawal: Withdrawal): Promise<{ status: boolean; amount: BigNumber }> {
    let amountPaid: BigNumber = BigNumber.from('0');
    for (let i = 0; i < withdrawal.transfers.length; i++) {
      const transfer = withdrawal.transfers[i];
      if (transfer.to.toLocaleLowerCase() === this.relayerAddress.toLocaleLowerCase()) {
        amountPaid = BigNumber.from(transfer.value);
        break;
      }
    }

    if (amountPaid.eq(0)) {
      return { status: false, amount: BigNumber.from('0') };
    }

    let timestamp = new Date(withdrawal.timestamp).getTime() / 1000;

    const validationAttempts = 5;
    for (let i = 0; i < validationAttempts; i++) {
      try {
        const gasCost = await this.gasService.getGasCostPerTimestamp(timestamp, withdrawal.bridgeAddress);
        if (amountPaid.gte(gasCost)) {
          return { status: true, amount: gasCost };
        }
      } catch (error: any) {
        this.logger.error(error.toString());
        throw error;
      }
      timestamp -= CheckPointSizeMs;
    }
    return { status: false, amount: BigNumber.from('0') };
  }

  checkIfGasCostCoverTheTransaction = async (
    totalPaid: BigNumber,
    totalGasToUse: BigNumber,
    numberOfWithdrawals: number,
  ): Promise<{ status: boolean; networkCost?: BigNumber }> => {
    if (numberOfWithdrawals === 0) return { status: false };

    const currentGasPrice = await this.web3Service.getCurrentGasPrice();
    const networkCost = currentGasPrice.mul(totalGasToUse);

    if (networkCost.lte(totalPaid)) return { status: true, networkCost };

    this.logger.warn('The total gas cost paid can not cover the transaction cost, sleep', {
      networkCost,
      totalPaid,
      currentGasPrice,
      numberOfWithdrawals,
    });

    this.networkFeesMetadata = {
      isHighFee: true,
      networkCost: formatDecimals(networkCost),
      usersPaid: formatDecimals(totalPaid),
      numberOfWithdrawals,
    };
    throw new Error('The total gas cost paid can not cover the transaction cost, sleep');
  };

  checkRelayerBalance = async () => {
    const balance = await this.web3Service.getRelayerL1Balance();
    if (balance.gt(MinimumEthBalance)) return;
    await RelayerNotifications.emitLowRelayerBalance(this.discordService, this.networkId, {
      balance: formatDecimals(balance),
    });
  };

  checkNetworkHighFees = async () => {
    if (!this.networkFeesMetadata?.isHighFee) return;
    await RelayerNotifications.emitHighNetworkFees(this.discordService, this.networkId, {
      totalWithdrawals: this.networkFeesMetadata?.numberOfWithdrawals,
      usersPaid: formatBalance(BigNumber.from(this.networkFeesMetadata?.usersPaid)),
      required: formatBalance(BigNumber.from(this.networkFeesMetadata?.networkCost)),
    });
  };

  getRelayerBalances = async (): Promise<RelayerBalances> => {
    const res = await this.callWithRetry({
      callback: async () => {
        const l1Balance = await this.web3Service.getRelayerL1Balance();
        const l2Balance = await this.web3Service.getRelayerL2Balance();

        return {
          l1Balance: formatBalance(l1Balance).toString(),
          l2Balance: formatBalance(l2Balance).toString(),
        };
      },
      errorCallback: (error: any) => {
        this.logger.warn(`Error to get relayer balances: ${error}`);
      },
    });
    if (!res) {
      return {
        l1Balance: 'NA',
        l2Balance: 'NA',
      };
    }
    return res;
  };

  canWakeupRelayer = async (lastStateBlock: number, sleepDelay: number, retryDelay: number): Promise<number> => {
    let lastUpdateStateTimestamp: number;
    while (true) {
      const currentStateBlock = (await this.web3Service.getStateBlockNumber()).toNumber();
      if (currentStateBlock > lastStateBlock) {
        this.logger.log(`L1 update state is in progress... sleep ${sleepDelay / 1000} sec`, {
          currentStateBlock,
          lastStateBlock,
        });
        lastStateBlock = currentStateBlock;
        lastUpdateStateTimestamp = Date.now();
        await sleep(sleepDelay);
        continue;
      }

      if (lastUpdateStateTimestamp) {
        await sleep(sleepDelay);
        return currentStateBlock;
      }
      await sleep(retryDelay);
    }
  };
}
