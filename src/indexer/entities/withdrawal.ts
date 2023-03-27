export interface Withdrawal {
  __typename: string;
  blockHeight: string;
  bridgeAddress: string;
  l1Recipient: string;
  amount: string;
  callerAddress: string;
  transfers: Transfer[];
  timestamp: string;
}

export interface Transfer {
  from_: string;
  to: string;
  value: string;
}
