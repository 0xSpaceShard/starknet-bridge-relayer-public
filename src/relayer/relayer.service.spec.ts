import { Test, TestingModule } from '@nestjs/testing';
import { RelayerService } from './relayer.service';
import { MongoService } from 'storage/mongo/mongo.service';
import { Web3Service } from 'web3/web3.service';
import { ConfigService } from 'common/config';
import { IndexerService } from 'indexer/indexer.service';
import { totalWithdrawalMock } from './__mocks__/IndexerService_mock';
import {
  canConsumeMessageOnL1MulticallView3NoTrustModeResponse,
  canConsumeMessageOnL1MulticallView3TrustModeResponse,
  canConsumeMessageOnL1MulticallViewResponse,
  canConsumeMessageOnL1MulticallViewResponseExpectedOutput,
  multcallRequestConsumeMessagesOnL1Mock,
  withdrawalsResponseMock,
  withdrawalsResponseMock2,
  withdrawalsResponseMock3,
} from './__mocks__/data';
import { l2BridgeAddressToL1 } from './relayer.constants';
import { MulticallRequest, MulticallResponse } from 'web3/web3.interface';
import { PrometheusService } from 'common/prometheus';
import { getMessageHash } from './utils';
import { ADDRESSES } from 'web3/web3.constants';
import { BigNumber, ethers } from 'ethers';
import { createMock } from '@golevelup/ts-jest';
import { Withdrawal } from 'indexer/entities';

describe.only('RelayerService', () => {
  let service: RelayerService;
  let web3Service: Web3Service;
  let indexerService: IndexerService;
  let mongoService: MongoService;
  const verbose = false;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelayerService,
        ConfigService,
        PrometheusService,
        {
          provide: MongoService,
          useValue: createMock(),
        },
        {
          provide: Web3Service,
          useValue: createMock({
            encodeCalldataStarknetCore: jest.fn((fnName: string, callData: string[]) => {
              const web3Service = new Web3Service(new ConfigService());
              return web3Service.encodeCalldataStarknetCore(fnName, callData);
            }),
            getAddresses: jest.fn(() => {
              const web3Service = new Web3Service(new ConfigService());
              return web3Service.getAddresses();
            }),
            encodeBridgeToken: jest.fn((fnName: string, callData: string[]) => {
              const web3Service = new Web3Service(new ConfigService());
              return web3Service.encodeBridgeToken(fnName, callData);
            }),
          }),
        },
        {
          provide: IndexerService,
          useValue: createMock(),
        },
        {
          provide: 'NestWinston',
          useValue: {
            log: jest.fn((message: string, params: []) => {
              if (verbose) {
                console.log('INFO:', message, params);
              }
            }),
            error: jest.fn((message: string, params: []) => {
              if (verbose) {
                console.log('ERROR:', message, params);
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RelayerService>(RelayerService);
    web3Service = module.get<Web3Service>(Web3Service);
    indexerService = module.get<IndexerService>(IndexerService);
    mongoService = module.get<MongoService>(MongoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('Success get the message hash to consume on L1', () => {
    const expectedHash = '0x302d070309d4762649be301e2b9349809a2d4e5d9e045493bd14056c93cf895d';
    const l2BridgeAddress = '0x72eeb90833bae233a9585f2fa9afc99c187f0a3a82693becd6a4d700b37fc6b';
    const l1BridgeAddress = '0xf29aE3446Ce4688fCc792b232C21D1B9581E7baC';
    const l1ReceiverAddress = '0x0000000000000000000000000000000000000001';
    const amount = '100';
    const messagehash = getMessageHash(l2BridgeAddress, l1BridgeAddress, l1ReceiverAddress, amount);
    expect(messagehash).toEqual(expectedHash);
  });

  it('Success getLastProcessedBlock', async () => {
    const expectedOutput = 100;
    jest
      .spyOn(mongoService, 'getLastProcessedBlock')
      .mockReturnValue(Promise.resolve({ blockNumber: expectedOutput, id: '111' }));
    jest.spyOn(mongoService, 'updateProcessedBlock').mockImplementation();
    jest.spyOn(service, 'getLastProcessedBlock').mockReturnValue(Promise.resolve(expectedOutput));
    expect(await service.getLastProcessedBlock()).toEqual(expectedOutput);
  });

  it('Success canProcessWithdrawals', async () => {
    const lastProcessedBlock = 80;
    const lastIndexedBlock = 90;
    const stateBlockNumber = BigNumber.from('100');
    jest
      .spyOn(mongoService, 'getLastProcessedBlock')
      .mockReturnValue(Promise.resolve({ blockNumber: lastProcessedBlock, id: '111' }));
    jest.spyOn(mongoService, 'updateProcessedBlock').mockImplementation();
    jest.spyOn(indexerService, 'getLastIndexedBlock').mockReturnValue(Promise.resolve(lastIndexedBlock));
    jest.spyOn(web3Service, 'getStateBlockNumber').mockReturnValue(Promise.resolve(stateBlockNumber));

    const res = await service.canProcessWithdrawals();
    expect(res.fromBlock).toEqual(lastProcessedBlock);
    expect(res.toBlock).toEqual(lastIndexedBlock);
    expect(res.stateBlockNumber).toEqual(stateBlockNumber.toNumber());
  });

  it('Success getRequestWithdrawalAtBlocks, when pagination', async () => {
    const fromBlock = 100;
    const toBlock = 200;
    const withdrawalsFirstCall = totalWithdrawalMock(1000);
    const withdrawalsSecondCall = totalWithdrawalMock(100);
    jest
      .spyOn(indexerService, 'getWithdraws')
      .mockReturnValueOnce(Promise.resolve(withdrawalsFirstCall))
      .mockReturnValueOnce(Promise.resolve(withdrawalsSecondCall));

    const res = await service.getRequestWithdrawalAtBlocks(fromBlock, toBlock);
    expect(res.withdrawals.length).toEqual(withdrawalsFirstCall.length + withdrawalsSecondCall.length);
    expect(res.fromBlock).toEqual(fromBlock);
    expect(res.toBlock).toEqual(toBlock);
  });

  it('Success getRequestWithdrawalAtBlocks, when no pagination', async () => {
    const expectedOutput = {
      fromBlock: 100,
      toBlock: 150,
      withdrawals: withdrawalsResponseMock,
    };
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(expectedOutput.withdrawals));

    const res = await service.getRequestWithdrawalAtBlocks(expectedOutput.fromBlock, expectedOutput.toBlock);
    expect(res.withdrawals.length).toEqual(expectedOutput.withdrawals.length);
    expect(res.fromBlock).toEqual(expectedOutput.fromBlock);
    expect(res.toBlock).toEqual(expectedOutput.toBlock);
  });

  it('Success getRequestWithdrawalAtBlocks, when no transactions', async () => {
    const expectedOutput = {
      fromBlock: 100,
      toBlock: 150,
      withdrawals: withdrawalsResponseMock,
    };
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve([]));

    const res = await service.getRequestWithdrawalAtBlocks(expectedOutput.fromBlock, expectedOutput.toBlock);
    expect(res.withdrawals.length).toEqual(0);
    expect(res.fromBlock).toEqual(expectedOutput.fromBlock);
    expect(res.toBlock).toEqual(expectedOutput.toBlock);
  });

  it('Success getMulticallRequests', async () => {
    const fromBlock = 100;
    const toBlock = 150;
    const withdrawals = withdrawalsResponseMock;
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(withdrawals));
    const withdrawalAtBlocksResponse = await service.getRequestWithdrawalAtBlocks(fromBlock, toBlock);

    const res = service.getMulticallRequests(withdrawalAtBlocksResponse.withdrawals);
    expect(res.length).toEqual(withdrawalAtBlocksResponse.withdrawals.length);

    // const l2BridgeAddressToL1Addresses = l2BridgeAddressToL1('goerli');
    for (let i = 0; i < res.length; i++) {
      const req = res[i];
      expect(req.target).toEqual(ADDRESSES['goerli'].starknetCore);
      // Example: calldata = 0xa46efaf3c96dbee3b8d1478353813a10f1c9b396c187e8fa71cd80902b5005edb62d9b28
      // a46efaf3 => function selector => 4Bytes
      // messageHash => c96dbee3b8d1478353813a10f1c9b396c187e8fa71cd80902b5005edb62d9b28 => 32Bytes
      // total => 36 bytes (72 characters)
      expect(req.callData.replace('0x', '').length).toEqual(72);
    }
  });

  it('Success getListOfL2ToL1MessagesResult when there is single message hash', async () => {
    const fromBlock = 100;
    const toBlock = 150;
    const withdrawals = withdrawalsResponseMock;
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(withdrawals));
    const withdrawalAtBlocksResponse = await service.getRequestWithdrawalAtBlocks(fromBlock, toBlock);

    const allMulticallRequests = service.getMulticallRequests(withdrawalAtBlocksResponse.withdrawals);

    jest
      .spyOn(web3Service, 'canConsumeMessageOnL1MulticallView')
      .mockReturnValue(Promise.resolve(canConsumeMessageOnL1MulticallViewResponse as any));

    const viewMulticallResponse: Array<MulticallResponse> = await service.getListOfL2ToL1MessagesResult(
      allMulticallRequests,
      250,
    );

    for (let i = 0; i < viewMulticallResponse.length; i++) {
      expect(viewMulticallResponse[i].returnData).toEqual(canConsumeMessageOnL1MulticallViewResponse[i].returnData);
    }

    const allMulticallRequestsForMessagesCanBeConsumedOnL1 = service.getListOfValidMessagesToConsumedOnL1(
      withdrawalAtBlocksResponse.withdrawals,
      viewMulticallResponse,
      allMulticallRequests,
    );

    const withdrawalsCanBeConsumedList: Array<Withdrawal> = [];
    expect(viewMulticallResponse.length).toEqual(withdrawalAtBlocksResponse.withdrawals.length);
    for (let i = 0; i < withdrawalAtBlocksResponse.withdrawals.length; i++) {
      if (viewMulticallResponse[i].returnData == ethers.utils.hexZeroPad('0x1', 32)) {
        withdrawalsCanBeConsumedList.push(withdrawalAtBlocksResponse.withdrawals[i]);
      }
    }
    expect(withdrawalsCanBeConsumedList.length).toEqual(allMulticallRequestsForMessagesCanBeConsumedOnL1.length);

    for (let i = 0; i < withdrawalsCanBeConsumedList.length; i++) {
      const req = allMulticallRequestsForMessagesCanBeConsumedOnL1[i];
      const addresses = l2BridgeAddressToL1('goerli')[withdrawalsCanBeConsumedList[i].bridgeAddress];
      expect(req.target).toEqual(addresses.l1BridgeAddress);
      // function selector => a46efaf3 => 4Bytes
      // amount => c96dbee3b8d1478353813a10f1c9b396c187e8fa71cd80902b5005edb62d9b28 => 32Bytes
      // user =>   000000000000000000000000f1c9b396c187e8fa71cd80902b5005edb62d9b28 => 32Bytes
      // total => 64 bytes (128 characters)
      expect(req.callData.replace('0x', '').length).toEqual(136);
    }
  });

  it('Success getListOfL2ToL1MessagesResult limit', async () => {
    const fromBlock = 100;
    const toBlock = 150;
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(withdrawalsResponseMock));
    const withdrawalAtBlocksResponse = await service.getRequestWithdrawalAtBlocks(fromBlock, toBlock);

    const allMulticallRequests = service.getMulticallRequests(withdrawalAtBlocksResponse.withdrawals);

    // When limit = 2
    let limit = 2;
    jest
      .spyOn(web3Service, 'canConsumeMessageOnL1MulticallView')
      .mockReturnValueOnce(Promise.resolve(canConsumeMessageOnL1MulticallView3TrustModeResponse.slice(0, limit) as any))
      .mockReturnValueOnce(Promise.resolve(canConsumeMessageOnL1MulticallView3TrustModeResponse.slice(limit, 4) as any))
      .mockReturnValueOnce(Promise.resolve(canConsumeMessageOnL1MulticallView3TrustModeResponse.slice(4, 5) as any));

    let viewMulticallResponse: Array<MulticallResponse> = await service.getListOfL2ToL1MessagesResult(
      allMulticallRequests,
      limit,
    );
    expect(viewMulticallResponse.length).toEqual(allMulticallRequests.length);

    // When limit = 4
    limit = 4;
    jest
      .spyOn(web3Service, 'canConsumeMessageOnL1MulticallView')
      .mockReturnValueOnce(Promise.resolve(canConsumeMessageOnL1MulticallView3TrustModeResponse.slice(0, limit) as any))
      .mockReturnValueOnce(
        Promise.resolve(canConsumeMessageOnL1MulticallView3TrustModeResponse.slice(limit, 5) as any),
      );

    viewMulticallResponse = await service.getListOfL2ToL1MessagesResult(allMulticallRequests, limit);
    expect(viewMulticallResponse.length).toEqual(allMulticallRequests.length);
  });

  it('Success getListOfL2ToL1MessagesResult when there is duplicate message hash in trust mode', async () => {
    process.env.TRUSTED_MODE = 'true';
    const fromBlock = 100;
    const toBlock = 150;
    const withdrawals = withdrawalsResponseMock3;
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(withdrawals));
    const withdrawalAtBlocksResponse = await service.getRequestWithdrawalAtBlocks(fromBlock, toBlock);

    const allMulticallRequests = service.getMulticallRequests(withdrawalAtBlocksResponse.withdrawals);

    jest
      .spyOn(web3Service, 'canConsumeMessageOnL1MulticallView')
      .mockReturnValue(Promise.resolve(canConsumeMessageOnL1MulticallView3TrustModeResponse as any));

    const viewMulticallResponse: Array<MulticallResponse> = await service.getListOfL2ToL1MessagesResult(
      allMulticallRequests,
      250,
    );

    for (let i = 0; i < viewMulticallResponse.length; i++) {
      expect(viewMulticallResponse[i].returnData).toEqual(
        canConsumeMessageOnL1MulticallView3TrustModeResponse[i].returnData,
      );
    }

    const allMulticallRequestsForMessagesCanBeConsumedOnL1 = service.getListOfValidMessagesToConsumedOnL1(
      withdrawalAtBlocksResponse.withdrawals,
      viewMulticallResponse,
      allMulticallRequests,
    );

    const withdrawalsCanBeConsumedList: Array<Withdrawal> = [];
    expect(viewMulticallResponse.length).toEqual(withdrawalAtBlocksResponse.withdrawals.length);
    for (let i = 0; i < withdrawalAtBlocksResponse.withdrawals.length; i++) {
      if (viewMulticallResponse[i].returnData == ethers.utils.hexZeroPad('0x1', 32)) {
        withdrawalsCanBeConsumedList.push(withdrawalAtBlocksResponse.withdrawals[i]);
      }
    }
    expect(allMulticallRequestsForMessagesCanBeConsumedOnL1.length).toEqual(2);
  });

  it('Success getListOfL2ToL1MessagesResult when there is duplicate message hash in no trust mode', async () => {
    process.env.TRUSTED_MODE = 'false';
    const fromBlock = 100;
    const toBlock = 150;
    const withdrawals = withdrawalsResponseMock3;
    jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(withdrawals));
    const withdrawalAtBlocksResponse = await service.getRequestWithdrawalAtBlocks(fromBlock, toBlock);

    const allMulticallRequests = service.getMulticallRequests(withdrawalAtBlocksResponse.withdrawals);

    jest
      .spyOn(web3Service, 'canConsumeMessageOnL1MulticallView')
      .mockReturnValue(Promise.resolve(canConsumeMessageOnL1MulticallView3NoTrustModeResponse as any));

    const viewMulticallResponse: Array<MulticallResponse> = await service.getListOfL2ToL1MessagesResult(
      allMulticallRequests,
      250,
    );

    for (let i = 0; i < viewMulticallResponse.length; i++) {
      expect(viewMulticallResponse[i].returnData).toEqual(
        canConsumeMessageOnL1MulticallView3NoTrustModeResponse[i].returnData,
      );
    }

    const allMulticallRequestsForMessagesCanBeConsumedOnL1 = service.getListOfValidMessagesToConsumedOnL1(
      withdrawalAtBlocksResponse.withdrawals,
      viewMulticallResponse,
      allMulticallRequests,
    );

    const withdrawalsCanBeConsumedList: Array<Withdrawal> = [];
    expect(viewMulticallResponse.length).toEqual(canConsumeMessageOnL1MulticallView3NoTrustModeResponse.length);
    for (let i = 0; i < viewMulticallResponse.length; i++) {
      if (viewMulticallResponse[i].returnData == ethers.utils.hexZeroPad('0x1', 32)) {
        withdrawalsCanBeConsumedList.push(withdrawalAtBlocksResponse.withdrawals[i]);
      }
    }
    expect(allMulticallRequestsForMessagesCanBeConsumedOnL1.length).toEqual(1);
  });

  it('Success processWithdrawals', async () => {
    const expectedValues = [
      { fromBlock: 100, toBlock: 150, stateBlockNumber: 150 },
      { fromBlock: 150, toBlock: 170, stateBlockNumber: 170 },
      { fromBlock: 170, toBlock: 220, stateBlockNumber: 230 },
    ];
    for (let i = 0; i < expectedValues.length; i++) {
      const { fromBlock, toBlock, stateBlockNumber } = expectedValues[i];

      jest.spyOn(service, 'getRequestWithdrawalAtBlocks').mockReturnValue(
        Promise.resolve({
          fromBlock,
          toBlock,
          withdrawals: withdrawalsResponseMock,
        }),
      );

      jest
        .spyOn(web3Service, 'canConsumeMessageOnL1MulticallView')
        .mockReturnValue(Promise.resolve(canConsumeMessageOnL1MulticallViewResponse as any));
      jest.spyOn(mongoService, 'updateProcessedBlock').mockImplementation();

      const res = await service.processWithdrawals(fromBlock, toBlock, stateBlockNumber);
      expect(res.currentFromBlockNumber).toEqual(fromBlock);
      expect(res.stateBlockNumber).toEqual(stateBlockNumber);
      expect(res.currentToBlockNumber).toEqual(toBlock);
      expect(res.totalWithdrawals).toEqual(5);
      expect(res.totalWithdrawalsProcessed).toEqual(canConsumeMessageOnL1MulticallViewResponseExpectedOutput.valid);
    }
  });

  it('Success consume messages on L1 with limit', async () => {
    let limit = 2;
    jest.spyOn(web3Service, 'callWithdrawMulticall').mockReturnValue(Promise.resolve(createMock()));
    jest
      .spyOn(service, '_consumeMessagesOnL1')
      .mockImplementation(async (multicall: Array<MulticallRequest>): Promise<ethers.ContractTransaction> => {
        expect(multicall.length).toEqual(2);
        return createMock<ethers.ContractTransaction>();
      });

    let length = await service.consumeMessagesOnL1(multcallRequestConsumeMessagesOnL1Mock, limit);
    expect(length).toEqual(Math.ceil(multcallRequestConsumeMessagesOnL1Mock.length / limit));

    limit = 5;
    jest
      .spyOn(service, '_consumeMessagesOnL1')
      .mockImplementation(async (multicall: Array<MulticallRequest>): Promise<ethers.ContractTransaction> => {
        expect(multicall.length).toEqual(5);
        return createMock<ethers.ContractTransaction>();
      });
    length = await service.consumeMessagesOnL1(multcallRequestConsumeMessagesOnL1Mock, limit);
    expect(length).toEqual(Math.ceil(multcallRequestConsumeMessagesOnL1Mock.length / limit));

    limit = 6;
    jest
      .spyOn(service, '_consumeMessagesOnL1')
      .mockImplementationOnce(async (multicall: Array<MulticallRequest>): Promise<ethers.ContractTransaction> => {
        expect(multicall.length).toEqual(6);
        return createMock<ethers.ContractTransaction>();
      })
      .mockImplementationOnce(async (multicall: Array<MulticallRequest>): Promise<ethers.ContractTransaction> => {
        expect(multicall.length).toEqual(4);
        return createMock<ethers.ContractTransaction>();
      });
    length = await service.consumeMessagesOnL1(multcallRequestConsumeMessagesOnL1Mock, limit);
    expect(length).toEqual(Math.ceil(multcallRequestConsumeMessagesOnL1Mock.length / limit));
  });

  it('Success checkIfUserPaiedTheRelayer', () => {
    let isValid = service.checkIfUserPaiedTheRelayer([
      {
        from_: '0x',
        to: '0x027f237537479fd27551379d1acc58f5448386a7094aac9b269e5d57aaf9d8c7',
        value: '100',
      },
    ]);
    expect(isValid).toEqual(true);

    isValid = service.checkIfUserPaiedTheRelayer([
      {
        from_: '0x',
        to: '0x0000000000000000000000000000000000000000000000000000000000000020',
        value: '100',
      },
    ]);
    expect(isValid).toEqual(false);
  });

  it('Success callWithRetry', async () => {
    const errorMessage = 'Error to process';
    expect(async () => {
      try {
        await service.callWithRetry({
          callback: () => {
            throw errorMessage;
          },
          errorCallback: (error: any) => {
            throw error;
          },
        });
      } catch (error: any) {
        expect(error).toEqual(errorMessage);
      }
    });
  });

  it('Success trusted mode', async () => {
    const testCases = [
      {
        fromBlock: 100,
        toBlock: 150,
        withdrawals: withdrawalsResponseMock2,
        trustedMode: true,
        expectedLength: 5,
      },
      {
        fromBlock: 100,
        toBlock: 150,
        withdrawals: withdrawalsResponseMock2,
        trustedMode: false,
        expectedLength: 2,
      },
    ];

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      process.env.TRUSTED_MODE = String(testCase.trustedMode);

      jest.spyOn(indexerService, 'getWithdraws').mockReturnValue(Promise.resolve(testCase.withdrawals));
      const withdrawalAtBlocksResponse = await service.getRequestWithdrawalAtBlocks(
        testCase.fromBlock,
        testCase.toBlock,
      );

      const res = service.getMulticallRequests(withdrawalAtBlocksResponse.withdrawals);
      expect(res.length).toEqual(testCase.expectedLength);
    }
  });
});
