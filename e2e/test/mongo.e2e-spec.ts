import { WithdrawalDoc } from './interfaces';
import { ethers, BigNumber } from 'ethers';
import { decodeBSONFile, getMessageHash } from './utils';
import { l2BridgeAddressToL1 } from '../../src/relayer/relayer.constants';
import { Starknet, Starknet__factory } from '../starknet-core/typechain-types';
import { ADDRESSES } from '../../src/web3/web3.constants';
import * as dotenv from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { RelayerService } from '../../src/relayer/relayer.service';
import { RelayerModule } from '../../src/relayer/relayer.module';
import { ContractAddress } from '../../src/web3/web3.interface';
import { ConfigService } from '../../src/common/config';
import { MongoService } from '../../src/storage/mongo/mongo.service';
import { IndexerService } from 'indexer/indexer.service';
import { IndexerModule } from 'indexer/indexer.module';
import { MongoModule } from 'storage/mongo/mongo.module';

dotenv.config();
jest.useRealTimers();

describe('Relayer (e2e)', () => {
  let configService: ConfigService;
  let moduleFixture: TestingModule;
  let mongoService: MongoService;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [MongoModule],
    }).compile();
    mongoService = moduleFixture.get<MongoService>(MongoService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('MongoService: test updateProcessedBlock and getLastProcessedBlock', async () => {
    const fromBlock = 786000;
    await mongoService.updateProcessedBlock(fromBlock);
    const lastProcessedBlock = await mongoService.getLastProcessedBlock();
    expect(lastProcessedBlock.blockNumber).toEqual(fromBlock);
  });
});
