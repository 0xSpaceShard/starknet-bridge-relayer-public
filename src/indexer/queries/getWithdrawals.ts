import { gql } from 'graphql-request';

export const getWithdrawalsQuery = gql`
  query GetWithdrawsQuery($limit: Int, $skip: Int!, $fromBlock: Int!, $toBlock: Int!) {
    withdraws(limit: $limit, skip: $skip) {
      bridgeAddress
      l1Recipient
      amount
      callerAddress
      timestamp
    }
  }
`;
