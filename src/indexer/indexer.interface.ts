import { Withdrawal } from 'indexer/entities';

export interface GetWithdrawalsResponse {
  data: {
    withdraw: Array<Withdrawal>;
  };
}
