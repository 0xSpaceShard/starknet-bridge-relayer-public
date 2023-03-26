import { Injectable } from '@nestjs/common';
import { ConfigService } from 'common/config';
import { Web3Service } from 'web3/web3.service';
import { RequestWithdrawalAtBlocks } from './relayer.interface';
import { MulticallRequest, MulticallResponse } from 'web3/web3.interface';
import { TRANSFER_FROM_STARKNET, ZeroBytes, l2BridgeAddressToL1 } from './relayer.constants';
import { MongoService } from 'storage/mongo/mongo.service';
import { ethers } from 'ethers';
import { uint256 } from 'starknet';
import { Withdrawal } from 'indexer/entities';
import { IndexerService } from 'indexer/indexer.service';

@Injectable()
export class RelayerService {
  constructor(
    private configService: ConfigService,
    private web3Service: Web3Service,
    private mongoService: MongoService,
    private indexerService: IndexerService,
  ) {}

  async run() {
    while (true) {
      try {
        this.processWithdrawals();
      } catch (error) {}
    }
  }

  async processWithdrawals() {
    let fromBlockNumber = await this.getLastProcessedBlock();
    const stateBlockNumber = (await this.web3Service.getStateBlockNumber()).toNumber();

    if (stateBlockNumber <= fromBlockNumber) {
      return;
    }

    const chunk = 100;
    let currentFromBlockNumber = fromBlockNumber;
    let currentToBlockNumber = currentFromBlockNumber + chunk;

    while (currentFromBlockNumber < stateBlockNumber) {
      if (currentToBlockNumber > stateBlockNumber) {
        currentToBlockNumber = stateBlockNumber;
      }

      const requestWithdrawalAtBlocks = await this.getRequestWithdrawalAtBlocks(
        currentFromBlockNumber,
        currentToBlockNumber,
      );

      const allMulticallRequests: Array<MulticallRequest> = this.getMulticallRequests(
        requestWithdrawalAtBlocks.withdrawals,
      );

      const viewMulticallResponse: MulticallResponse = await this.web3Service.canConsumeMessageOnL1MulticallView(
        allMulticallRequests,
      );

      const allMulticallRequestsForMessagesCanBeConsumedOnL1 = this.getListOfValidMessagesToConsumedOnL1(
        viewMulticallResponse,
        allMulticallRequests,
      );

      this.consumeMessagesOnL1(currentToBlockNumber, allMulticallRequestsForMessagesCanBeConsumedOnL1);

      currentFromBlockNumber = currentToBlockNumber;
    }
  }

  async getLastProcessedBlock(): Promise<number> {
    let lastProcessedBlockNumber = (await this.mongoService.getLastProcessedBlock()).blockNumber;
    if (!lastProcessedBlockNumber) {
      const startBlock = this.configService.get('START_BLOCK');
      await this.mongoService.updateProcessedBlock(startBlock);
      lastProcessedBlockNumber = startBlock;
    }
    return lastProcessedBlockNumber;
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
      // TODO: implement retry
      const withdrawals: Array<Withdrawal> = await this.indexerService.getWithdraws(limit, skip, fromBlock, toBlock);
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

  async consumeMessagesOnL1(toBlock: number, multicallRequest: Array<MulticallRequest>) {
    await this.web3Service.callWithdrawMulticall(multicallRequest);
    return await this.mongoService.updateProcessedBlock(toBlock);
  }

  getMessageHash(l2BridgeAddress: string, l1BridgeAddress: string, receiverL1: string, amount: string): string {
    const amountUint256 = uint256.bnToUint256(amount.toString());
    const payload = [TRANSFER_FROM_STARKNET, receiverL1, amountUint256.low, amountUint256.high];
    return ethers.utils.solidityKeccak256(
      ['uint256', 'address', 'uint256', 'uint256[]'],
      [l2BridgeAddress, l1BridgeAddress, payload.length, payload],
    );
  }
}
