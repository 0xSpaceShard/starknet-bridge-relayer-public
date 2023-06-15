import { BigNumber } from 'ethers/lib/ethers';
import { Withdrawal } from 'indexer/entities';

export interface RequestWithdrawalAtBlocks {
  fromBlock: number;
  toBlock: number;
  withdrawals: Array<Withdrawal>;
}

export interface MessagesCanBeConsumedOnL1 extends RequestWithdrawalAtBlocks {
  callData: string;
}

export interface BridgeMetadata {
  name: string;
  symbol: string;
  decimals: number;
  l1TokenAddress: string;
  l2TokenAddress: string;
  l1BridgeAddress: string;
}

export interface ProcessWithdrawalsResults {
  currentFromBlockNumber: number;
  currentToBlockNumber: number;
  stateBlockNumber: number;
  totalWithdrawalsProcessed: number;
  totalWithdrawals: number;
  allInvalidPaidGasCost: number;
}

export interface CheckCanProcessWithdrawalsResults {
  fromBlock: number;
  toBlock: number;
  stateBlockNumber: number;
}

export interface RelayerBalances {
  l1Balance: string;
  l2Balance: string;
}
