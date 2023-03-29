import { Withdrawal } from 'indexer/entities';

export interface GetWithdrawalsResponse {
  withdraw: Array<Withdrawal>;
}
