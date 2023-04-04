import { WithdrawalDoc } from './interfaces';
import { ethers, BigNumber } from 'ethers';
import { decodeBSONFile, getMessageHash } from './utils';
import { l2BridgeAddressToL1 } from '../../src/relayer/relayer.constants';
import { Starknet, Starknet__factory } from '../starknet-core/typechain-types';
import { ADDRESSES } from '../../src/web3/web3.constants';
import * as dotenv from 'dotenv';
import { INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RelayerService } from '../../src/relayer/relayer.service';
import { RelayerModule } from '../../src/relayer/relayer.module';
import { ContractAddress } from 'web3/web3.interface';
import { ConfigService } from 'common/config';
import { MongoService } from 'storage/mongo/mongo.service';

dotenv.config();
jest.useRealTimers();

describe('Relayer (e2e)', () => {
  let app: INestApplication;
  let relayerService: RelayerService;
  let configService: ConfigService;
  let mongoService: MongoService;
  let moduleFixture: TestingModule;
  let signer: ethers.Wallet;
  let l2BridgeAddressToL1Addresses: any;
  let coreAddresses: ContractAddress;
  let provider: ethers.providers.JsonRpcProvider;
  let starknet: Starknet;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [RelayerModule],
    }).compile();
    relayerService = moduleFixture.get<RelayerService>(RelayerService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
    mongoService = moduleFixture.get<MongoService>(MongoService);

    provider = new ethers.providers.JsonRpcProvider('http://0.0.0.0:8545');
    const privateKey = process.env.PRIVATE_KEY;
    const network = process.env.NETWORK_ID;
    signer = new ethers.Wallet(privateKey, provider);
    l2BridgeAddressToL1Addresses = l2BridgeAddressToL1(network);
    coreAddresses = ADDRESSES[network];

    starknet = Starknet__factory.connect(coreAddresses.starknetCore, signer) as Starknet;
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('Test Relayer with some no valid transactions', async () => {
    const fromBlock = 786000;
    const toBlock = 786200;
    const stateBlock = 786200;
    const docs = 360;
    const txs = 50;

    await starknet.setStateBlockNumber(stateBlock);

    const withdrawals: WithdrawalDoc[] = decodeBSONFile(
      './e2e/data/dump-1/starknet_bridge_indexer/withdraw.bson',
      docs,
      0,
    );

    const messageHashesDelete = [];
    const messageHashesAdd = [];
    const users = [];
    const userBalancesBefore: Array<BigNumber> = [];

    // Add messages to Starknet core contract, add only the `withdrawals.length / 2`
    {
      for (let i = 0; i < docs; i++) {
        const withdraw = withdrawals[i];
        const l1Recipient = withdraw.l1_recipient.toString('hex').replace('000000000000000000000000', '0x');
        const l2BridgeAddress = withdraw.bridge_address.toString('hex');
        const l1BridgeAddress = l2BridgeAddressToL1Addresses[l2BridgeAddress].l1BridgeAddress;
        const amount = BigNumber.from('0x' + withdraw.amount.toString('hex')).toString();
        const msgHash = getMessageHash(l2BridgeAddress, l1BridgeAddress, l1Recipient, amount);
        messageHashesDelete.push(msgHash);
        if (i < txs) {
          messageHashesAdd.push(msgHash)
        }
        userBalancesBefore.push(await provider.getBalance(l1Recipient));
        users.push(l1Recipient);
      }
      await starknet.connect(signer).deleteMessage(messageHashesDelete);
      
      await starknet.connect(signer).addMessage(messageHashesAdd);

      for (let i = 0; i < txs; i++) {
        expect((await starknet.l2ToL1Messages(messageHashesAdd[i])).toNumber()).toBeGreaterThan(0);
      }
    }

    // Process transactions
    const processWithdrawalsResult = await relayerService.processWithdrawals(fromBlock, toBlock, stateBlock);
    console.log(processWithdrawalsResult)
    expect(processWithdrawalsResult.currentFromBlockNumber).toEqual(toBlock - 50);
    expect(processWithdrawalsResult.currentToBlockNumber).toEqual(toBlock);
    expect(processWithdrawalsResult.stateBlockNumber).toEqual(stateBlock);
    expect(processWithdrawalsResult.totalWithdrawals).toEqual(withdrawals.length);
    expect(processWithdrawalsResult.totalWithdrawalsProcessed).toEqual(txs);

    // Check if the
    const userBalancesAfter: Array<BigNumber> = [];
    for (let i = 0; i < txs; i++) {
      userBalancesAfter.push(await provider.getBalance(users[i]));
    }

    for (let i = 0; i < userBalancesAfter.length; i++) {
      expect(userBalancesAfter[i].sub(userBalancesBefore[i])).not.toEqual(0);
    }
    expect((await mongoService.getLastProcessedBlock()).blockNumber).toEqual(toBlock);
  });
});
