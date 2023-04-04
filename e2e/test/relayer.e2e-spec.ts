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

dotenv.config();
jest.useRealTimers();

describe('Relayer (e2e)', () => {
  let app: INestApplication;
  let relayerService: RelayerService;
  let moduleFixture: TestingModule;
  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [RelayerModule],
    }).compile();
    relayerService = moduleFixture.get<RelayerService>(RelayerService);
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('Test Relayer in trusted mode', async () => {
    const provider = new ethers.providers.JsonRpcProvider('http://0.0.0.0:8545');
    const privateKey = process.env.PRIVATE_KEY;
    const network = process.env.NETWORK_ID;
    const signer = new ethers.Wallet(privateKey, provider);
    const l2BridgeAddressToL1Addresses = l2BridgeAddressToL1(network);
    const coreAddresses = ADDRESSES[network];

    // Add messages hash to the Starknet contract.
    const starknet = Starknet__factory.connect(coreAddresses.starknetCore, signer) as Starknet;

    // Set the state block height
    const withdrawals: WithdrawalDoc[] = decodeBSONFile('./e2e/data/dump/starknet_bridge_indexer/withdraw.bson', 4, 0);
    await starknet.setStateBlockNumber(786000);

    const messageHashes = [];
    const users = [];
    const userBalancesBefore = [];

    // Add messages to Starknet core contract
    {
      for (let i = 0; i < withdrawals.length; i++) {
        const withdraw = withdrawals[i];
        const l1Recipient = withdraw.l1_recipient.toString('hex').replace('000000000000000000000000', '0x');
        const l2BridgeAddress = withdraw.bridge_address.toString('hex');
        const l1BridgeAddress = l2BridgeAddressToL1Addresses[l2BridgeAddress].l1BridgeAddress;
        const amount = BigNumber.from('0x' + withdraw.amount.toString('hex')).toString();
        const msgHash = getMessageHash(l2BridgeAddress, l1BridgeAddress, l1Recipient, amount);
        messageHashes.push(msgHash);
        userBalancesBefore.push(await provider.getBalance(l1Recipient));
        users.push(l1Recipient);
      }
      await starknet.connect(signer).addMessage(messageHashes);
      
      for (let i = 0; i < messageHashes.length; i++) {
        expect(await starknet.l2ToL1Messages(messageHashes[i])).toEqual(BigNumber.from('1'));
      }
    }

    // Process transactions
    await relayerService.processWithdrawals(786000, 786002, 786010);

    // Check if the 
    const userBalancesAfter = [];
    for (let i = 0; i < users.length; i++) {
      userBalancesAfter.push(await provider.getBalance(users[i]));
    }

    for (let i = 0; i < userBalancesBefore.length; i++) {
      expect(userBalancesAfter[i].sub(userBalancesBefore[i])).toEqual(BigNumber.from(withdrawals[i].amount));
    }
    for (let i = 0; i < messageHashes.length; i++) {
      expect(await starknet.l2ToL1Messages(messageHashes[i])).toEqual(BigNumber.from('0'));
    }
  });
});
