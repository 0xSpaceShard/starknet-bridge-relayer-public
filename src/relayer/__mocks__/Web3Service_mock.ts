import { BigNumber, ethers } from 'ethers';
import { canConsumeMessageOnL1MulticallViewResponse, fromBlockNumberMock } from './data';
import { Web3Service } from 'web3/web3.service';
import { ConfigService } from 'common/config';

export const Web3ServiceMock = {
  getStateBlockNumber: jest.fn(() => {
    return BigNumber.from(fromBlockNumberMock.toString());
  }),
  canConsumeMessageOnL1MulticallView: jest.fn(() => {
    return canConsumeMessageOnL1MulticallViewResponse;
  }),
  callWithdraw: jest.fn(() => {
    return {};
  }),
  encodeCalldataStarknetCore: jest.fn((fnName: string, callData: string[]) => {
    const web3Service = new Web3Service(new ConfigService());
    return web3Service.encodeCalldataStarknetCore(fnName, callData);
  }),
  callWithdrawMulticall: jest.fn(() => {
    return {};
  }),
};
