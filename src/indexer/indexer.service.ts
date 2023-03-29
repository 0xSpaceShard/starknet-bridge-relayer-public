import { InjectGraphQLClient } from '@golevelup/nestjs-graphql-request';
import { Injectable } from '@nestjs/common';
import { GraphQLClient } from 'graphql-request';
import { GetWithdrawalsResponse } from './indexer.interface';
import { getWithdrawalsQuery } from './queries';
import { Withdrawal } from './entities';

@Injectable()
export class IndexerService {
  constructor(@InjectGraphQLClient() private readonly gqlClient: GraphQLClient) {}

  async getWithdraws(limit: number, offset: number, startBlock: number, endBlock: number): Promise<Array<Withdrawal>> {
    const res: GetWithdrawalsResponse = await this.gqlClient.request(getWithdrawalsQuery, {
      limit,
      offset,
      startBlock,
      endBlock,
    });
    return res?.withdraw;
  }
}
