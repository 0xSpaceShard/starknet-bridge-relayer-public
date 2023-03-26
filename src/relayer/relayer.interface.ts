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
