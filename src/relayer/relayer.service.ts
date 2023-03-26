import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from 'common/config';
import { Web3Service } from 'web3/web3.service';
import {
  CheckCanProcessWithdrawalsResults,
  ProcessWithdrawalsResults,
  RequestWithdrawalAtBlocks,
} from './relayer.interface';
import { MulticallRequest, MulticallResponse } from 'web3/web3.interface';
import { TRANSFER_FROM_STARKNET, ZeroBytes, l2BridgeAddressToL1 } from './relayer.constants';
import { MongoService } from 'storage/mongo/mongo.service';
import { ethers } from 'ethers';
import { uint256 } from 'starknet';
import { Withdrawal } from 'indexer/entities';
import { IndexerService } from 'indexer/indexer.service';
import { callWithRetry, sleep } from './relayer.utils';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

@Injectable()
export class RelayerService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private configService: ConfigService,
    private web3Service: Web3Service,
    private mongoService: MongoService,
    private indexerService: IndexerService,
  ) {}

  async run() {
    const sleepAfterSuccessExec = Number(this.configService.get('RELAYER_SLEEP_AFTER_SUCCESS_EXEC'));
    const sleepAfterFailExec = Number(this.configService.get('RELAYER_SLEEP_AFTER_FAIL_EXEC'));

    while (true) {
      try {
        const { status, lastProcessedBlockNumber, stateBlockNumber } = await this.canProcessWithdrawals();
        if (status) {
          const res = this.processWithdrawals(lastProcessedBlockNumber, stateBlockNumber);
          this.logger.log('Success process withdrawals:', res);
        }
      } catch (error: any) {
        sleep(sleepAfterFailExec);
        this.logger.error('Error run:', error);
      }
      this.logger.log(`Relayer sleep: ${sleepAfterSuccessExec} MS`);
      sleep(sleepAfterSuccessExec);
    }
  }

  async processWithdrawals(lastProcessedBlock: number, stateBlockNumber: number): Promise<ProcessWithdrawalsResults> {
    const chunk = Number(this.configService.get('NUMBER_OF_BLOCKS_TO_PROCESS_PER_CHUNK'));

    let currentFromBlockNumber = lastProcessedBlock;
    let currentToBlockNumber = currentFromBlockNumber + chunk;

    let totalWithdrawalsProcessed = 0;
    let totalWithdrawals = 0;

    // Start processed withdrawals between 2 blocks.
    while (currentToBlockNumber <= stateBlockNumber) {
      // Get Withdrawals from the indexer
      const requestWithdrawalAtBlocks = await this.getRequestWithdrawalAtBlocks(
        currentFromBlockNumber,
        currentToBlockNumber,
      );

      // Prepare multicallRequest data to check if the withdrawals can be consumed on L1
      const allMulticallRequests: Array<MulticallRequest> = this.getMulticallRequests(
        requestWithdrawalAtBlocks.withdrawals,
      );

      // Check which message hashs exists on L1.
      const viewMulticallResponse: MulticallResponse = await this.filterWhichMessagesCanBeConsumeOnL1MulticallView(
        allMulticallRequests,
      );

      // Filter the valid messages that can be consumed on L1.
      const allMulticallRequestsForMessagesCanBeConsumedOnL1 = this.getListOfValidMessagesToConsumedOnL1(
        viewMulticallResponse,
        allMulticallRequests,
      );

      // Consume the messages.
      await this.consumeMessagesOnL1(allMulticallRequestsForMessagesCanBeConsumedOnL1);

      // Store the last processed block on database.
      await this.updateProcessedBlock(currentToBlockNumber);

      // Update the block numbers.
      if (currentToBlockNumber + chunk > stateBlockNumber && currentToBlockNumber != stateBlockNumber) {
        currentToBlockNumber = stateBlockNumber;
      } else {
        currentToBlockNumber += chunk;
      }
      currentFromBlockNumber += chunk;

      // Update stats.
      totalWithdrawalsProcessed += allMulticallRequestsForMessagesCanBeConsumedOnL1.length;
      totalWithdrawals += allMulticallRequests.length;
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
    return await this.callWithRetry('mongoService.getLastProcessedBlock', async () => {
      let lastProcessedBlockNumber = (await this.mongoService.getLastProcessedBlock()).blockNumber;
      if (!lastProcessedBlockNumber) {
        const startBlock = this.configService.get('START_BLOCK');
        await this.updateProcessedBlock(startBlock);
        lastProcessedBlockNumber = startBlock;
      }
      return lastProcessedBlockNumber;
    });
  }

  async getRequestWithdrawalAtBlocks(fromBlock: number, toBlock: number): Promise<RequestWithdrawalAtBlocks> {
    const limit = 1000;
    let index = 0;

    const listRequestWithdrawalsAtBlocks: RequestWithdrawalAtBlocks = {
      fromBlock,
      toBlock,
      withdrawals: [],
    };

    while (true) {
      const skip = limit * index;
      const withdrawals: Array<Withdrawal> = await this.callWithRetry('indexerService.getWithdraws', async () => {
        return await this.indexerService.getWithdraws(limit, skip, fromBlock, toBlock);
      });

      if (withdrawals.length === 0) {
        break;
      }

      listRequestWithdrawalsAtBlocks.withdrawals.push(...withdrawals);
      index++;
    }
    return listRequestWithdrawalsAtBlocks;
  }

  getMulticallRequests(withdrawals: Array<Withdrawal>): Array<MulticallRequest> {
    const multicallRequests: Array<MulticallRequest> = [];
    const l2BridgeAddressToL1Addresses = l2BridgeAddressToL1(this.configService.get('NETWORK_ID'));

    for (let i = 0; i < withdrawals.length; i++) {
      const withdrawal = withdrawals[i];
      const l1BridgeAddress = l2BridgeAddressToL1Addresses[withdrawal.bridgeAddress].l1BridgeAddress;
      if (l1BridgeAddress) {
        multicallRequests.push({
          target: l2BridgeAddressToL1Addresses[withdrawal.bridgeAddress].l1BridgeAddress,
          callData: this.web3Service.encodeCalldataStarknetCore('l2ToL1Messages', [
            this.getMessageHash(withdrawal.bridgeAddress, l1BridgeAddress, withdrawal.l1Recipient, withdrawal.amount),
          ]),
        });
      }
    }
    return multicallRequests;
  }

  getListOfValidMessagesToConsumedOnL1(
    multicallResponse: MulticallResponse,
    allMulticallRequest: Array<MulticallRequest>,
  ): Array<MulticallRequest> {
    const multicallRequests: Array<MulticallRequest> = [];

    // Check which withdrawal can be processes
    for (let i = 0; i < multicallResponse.returnData.length; i++) {
      const txReturnData = multicallResponse.returnData[i];

      // If the `txReturnData` is ZERO it means the messages was already consumed.
      if (txReturnData == ZeroBytes) continue;

      multicallRequests.push(allMulticallRequest[i]);
    }
    return multicallRequests;
  }

  async consumeMessagesOnL1(multicallRequest: Array<MulticallRequest>) {
    await this.callWithRetry('web3Service.callWithdrawMulticall', async () => {
      await this.web3Service.callWithdrawMulticall(multicallRequest);
    });
  }

  async updateProcessedBlock(toBlock: number) {
    return await this.callWithRetry('mongoService.updateProcessedBlock', async () => {
      return await this.mongoService.updateProcessedBlock(toBlock);
    });
  }

  async filterWhichMessagesCanBeConsumeOnL1MulticallView(
    allMulticallRequests: Array<MulticallRequest>,
  ): Promise<MulticallResponse> {
    return await this.web3Service.canConsumeMessageOnL1MulticallView(allMulticallRequests);
  }

  getMessageHash(l2BridgeAddress: string, l1BridgeAddress: string, receiverL1: string, amount: string): string {
    const amountUint256 = uint256.bnToUint256(amount.toString());
    const payload = [TRANSFER_FROM_STARKNET, receiverL1, amountUint256.low, amountUint256.high];
    return ethers.utils.solidityKeccak256(
      ['uint256', 'address', 'uint256', 'uint256[]'],
      [l2BridgeAddress, l1BridgeAddress, payload.length, payload],
    );
  }

  async canProcessWithdrawals(): Promise<CheckCanProcessWithdrawalsResults> {
    let lastProcessedBlockNumber = await this.getLastProcessedBlock();
    const stateBlockNumber = (await this.web3Service.getStateBlockNumber()).toNumber();

    return {
      status: stateBlockNumber <= lastProcessedBlockNumber,
      lastProcessedBlockNumber,
      stateBlockNumber,
    };
  }

  async callWithRetry(functionId: string, callback: Function) {
    return await callWithRetry(this.logger, 3, callback, functionId);
  }
}
