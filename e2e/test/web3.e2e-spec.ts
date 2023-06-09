import * as dotenv from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { Web3Service } from 'web3/web3.service';
import { BigNumber } from '@ethersproject/bignumber/lib/bignumber';
import { Web3Module } from 'web3/web3.module';

dotenv.config();
jest.useRealTimers();

describe('Web3 (e2e)', () => {
  let moduleFixture: TestingModule;
  let web3Service: Web3Service;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [Web3Module],
    }).compile();
    web3Service = moduleFixture.get<Web3Service>(Web3Service);
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it.only('Should get l1 relayer balance', async () => {
    expect(await web3Service.getRelayerL1Balance()).not.toEqual(BigNumber.from("0"))
  });

  it.only('Should get l2 relayer balance', async () => {
    expect(await web3Service.getRelayerL2Balance()).not.toEqual(BigNumber.from("0"))
  });
});
