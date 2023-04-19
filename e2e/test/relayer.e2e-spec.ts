import { WithdrawalDoc } from './interfaces';
import { ethers, BigNumber } from 'ethers';
import { decodeBSONFile, getMessageHash } from './utils';
import { NumberOfWithdrawalsToProcessPerTransaction, l2BridgeAddressToL1 } from '../../src/relayer/relayer.constants';
import { Starknet, Starknet__factory } from '../starknet-core/typechain-types';
import { ADDRESSES, GAS_LIMIT_MULTIPLE_WITHDRAWAL, GAS_LIMIT_PER_WITHDRAWAL } from '../../src/web3/web3.constants';
import * as dotenv from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { RelayerService } from '../../src/relayer/relayer.service';
import { RelayerModule } from '../../src/relayer/relayer.module';
import { ContractAddress } from '../../src/web3/web3.interface';
import { ConfigService } from '../../src/common/config';
import { MongoService } from '../../src/storage/mongo/mongo.service';
import { IndexerService } from '../../src/indexer/indexer.service';
import { Web3Service } from '../../src/web3/web3.service';

dotenv.config();
jest.useRealTimers();

describe('Relayer (e2e)', () => {
  let relayerService: RelayerService;
  let configService: ConfigService;
  let mongoService: MongoService;
  let moduleFixture: TestingModule;
  let signer: ethers.Wallet;
  let l2BridgeAddressToL1Addresses: any;
  let coreAddresses: ContractAddress;
  let provider: ethers.providers.JsonRpcProvider;
  let starknet: Starknet;
  let indexerService: IndexerService;
  let web3Service: Web3Service;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [RelayerModule],
    }).compile();
    relayerService = moduleFixture.get<RelayerService>(RelayerService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
    mongoService = moduleFixture.get<MongoService>(MongoService);
    indexerService = moduleFixture.get<IndexerService>(IndexerService);
    web3Service = moduleFixture.get<Web3Service>(Web3Service);

    provider = new ethers.providers.JsonRpcProvider('http://hardhat:8545');
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

  it('Consume valid transactions', async () => {
    // const fromBlock = 786000;
    // const toBlock = 786500;
    // const stateBlock = 786550;
    // const docs = 694;

    const fromBlock = 786000;
    const toBlock = 786200;
    const stateBlock = 786250;
    const docs = 356;

    await starknet.setStateBlockNumber(stateBlock);

    const withdrawals: WithdrawalDoc[] = decodeBSONFile(
      './e2e/data/dump/starknet_bridge_indexer/withdraw.bson',
      docs,
      0,
    );

    const allMessageHashes = [];
    const validMessageHashes = [];
    const usersAddresses = [];
    const userBalancesBefore: Array<BigNumber> = [];
    const userExpectedAmountToReceive: any = {};
    let numberOfUsersToCheckBalanced = 10; // to avoid rate limiting

    {
      for (let i = 0; i < docs; i++) {
        const withdraw = withdrawals[i];
        const l1Recipient = withdraw.l1_recipient.toString('hex').replace('000000000000000000000000', '0x');
        const l2BridgeAddress = withdraw.bridge_address.toString('hex');
        const l1BridgeAddress = l2BridgeAddressToL1Addresses[l2BridgeAddress].l1BridgeAddress;
        const amount = BigNumber.from('0x' + withdraw.amount.toString('hex'));

        const msgHash = getMessageHash(l2BridgeAddress, l1BridgeAddress, l1Recipient, amount.toString());
        allMessageHashes.push(msgHash);

        validMessageHashes.push(msgHash);
        if (i < numberOfUsersToCheckBalanced) {
          userBalancesBefore.push(await provider.getBalance(l1Recipient));
          usersAddresses.push(l1Recipient);
        }
        if (!userExpectedAmountToReceive[l1Recipient]) {
          userExpectedAmountToReceive[l1Recipient] = amount;
        } else {
          userExpectedAmountToReceive[l1Recipient] = userExpectedAmountToReceive[l1Recipient].add(amount);
        }
      }
      
      await starknet.connect(signer).deleteMessage(allMessageHashes);
      await starknet.connect(signer).addMessage(validMessageHashes);
    }
    // Process transactions
    const processWithdrawalsResult = await relayerService.processWithdrawals(fromBlock, toBlock, stateBlock);
    if (docs > NumberOfWithdrawalsToProcessPerTransaction) {
      expect(processWithdrawalsResult.currentFromBlockNumber).toEqual(toBlock - NumberOfWithdrawalsToProcessPerTransaction);
    } else {
      expect(processWithdrawalsResult.currentFromBlockNumber).toEqual(fromBlock);
    }
    expect(processWithdrawalsResult.currentToBlockNumber).toEqual(toBlock);
    expect(processWithdrawalsResult.stateBlockNumber).toEqual(stateBlock);
    expect(processWithdrawalsResult.totalWithdrawals).toEqual(withdrawals.length);
    expect(processWithdrawalsResult.totalWithdrawalsProcessed).toEqual(validMessageHashes.length);

    // Get users balances after processing the transactions
    const userBalancesAfter: Array<BigNumber> = [];
    for (let i = 0; i < usersAddresses.length; i++) {
      userBalancesAfter.push(await provider.getBalance(usersAddresses[i]));
    }

    for (let i = 0; i < userBalancesAfter.length; i++) {
      expect(userBalancesAfter[i].sub(userBalancesBefore[i])).toEqual(userExpectedAmountToReceive[usersAddresses[i]]);
    }
    expect((await mongoService.getLastProcessedBlock()).blockNumber).toEqual(toBlock);
  });

  it('Check if canProcessWithdrawals', async () => {
    const stateBlock = 787050;
    const fromBlock = 786000;
    await starknet.setStateBlockNumber(stateBlock);
    await mongoService.updateProcessedBlock(786000);
    const toBlock = await indexerService.getLastIndexedBlock();
    const res = await relayerService.canProcessWithdrawals();
    expect(res.fromBlock).toEqual(fromBlock);
    expect(res.toBlock).toEqual(toBlock);
    expect(res.stateBlockNumber).toEqual(stateBlock);
  });

  it('calculate gas cost', async () => {
    const msgHash = '0x0e19665ae684518682f0f3b8b495c78869a082d4b55235f158e0e66b1106e4be';
    await starknet.addMessage([msgHash, msgHash]);
    expect((await starknet.l2ToL1Messages(msgHash)).toNumber()).not.toEqual(0);
    const hashes = [
      {
        callData: '0xa46efaf30e19665ae684518682f0f3b8b495c78869a082d4b55235f158e0e66b1106e4be',
        target: '0xde29d060D45901Fb19ED6C6e959EB22d8626708e',
      },
      {
        callData: '0xa46efaf30e19665ae684518682f0f3b8b495c78869a082d4b55235f158e0e66b1106e4be',
        target: '0xde29d060D45901Fb19ED6C6e959EB22d8626708e',
      },
    ];
    const tx = await web3Service.callWithdrawMulticall(hashes);

    expect(tx.gasLimit.toNumber()).toEqual(GAS_LIMIT_PER_WITHDRAWAL + GAS_LIMIT_MULTIPLE_WITHDRAWAL * hashes.length);
    const receipt = await provider.getTransactionReceipt(tx.hash);
    expect(receipt.gasUsed.toNumber()).toBeLessThan(GAS_LIMIT_PER_WITHDRAWAL);
  });
});
