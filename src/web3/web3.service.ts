import { Injectable } from '@nestjs/common';
import {
  Multicall,
  StarknetCore,
  StarknetTokenBridge,
  Multicall__factory,
  StarknetCore__factory,
  StarknetTokenBridge__factory,
  MulticallView__factory,
  MulticallView,
} from './generated';
import { ADDRESSES, getProviderURLs } from './web3.constants';
import { ConfigService } from 'common/config';
import { BigNumber, ethers } from 'ethers';
import { ContractAddress, MulticallRequest, Provider } from './web3.interface';
import * as StarknetCoreABI from './abis/StarknetCore.json';

@Injectable()
export class Web3Service {
  constructor(private configService: ConfigService) {}

  async getMulticallContract(): Promise<Multicall> {
    const provider = await this.getProvider();
    return Multicall__factory.connect(this.getAddresses().multicall, provider);
  }

  async getMulticallViewContract(): Promise<MulticallView> {
    const provider = await this.getProvider();
    return MulticallView__factory.connect(this.getAddresses().multicall, provider);
  }

  async getStarknetCoreContract(): Promise<StarknetCore> {
    const provider = await this.getProvider();
    return StarknetCore__factory.connect(this.getAddresses().starknetCore, provider);
  }

  async getStarknetTokenBridgeContract(bridgeAddress: string): Promise<StarknetTokenBridge> {
    const provider = await this.getProvider();
    return StarknetTokenBridge__factory.connect(bridgeAddress, provider);
  }

  async callWithdrawMulticall(multicallRequests: Array<MulticallRequest>) {
    const multicall = await this.getMulticallContract();
    return await multicall.aggregate(multicallRequests);
  }

  async callWithdraw(bridgeAddress: string, receiverL1: string, amount: BigNumber) {
    const starknetTokenBridge = await this.getStarknetTokenBridgeContract(bridgeAddress);
    await starknetTokenBridge['withdraw(uint256,address)'].call(this, [receiverL1, amount]);
  }

  async canConsumeMessageOnL1MulticallView(multicallRequests: Array<MulticallRequest>) {
    const multicallView = await this.getMulticallViewContract();
    return await multicallView.aggregate(multicallRequests);
  }

  async getStateBlockNumber(): Promise<BigNumber> {
    const starknetCore = await this.getStarknetCoreContract();
    return await starknetCore.stateBlockNumber();
  }

  encodeCalldataStarknetCore = (functionName: string, params: any[]): string => {
    let iface = new ethers.utils.Interface(StarknetCoreABI);
    return iface.encodeFunctionData(functionName, params);
  };

  async getProvider() {
    const providerURLs: Array<Provider> = getProviderURLs(this.configService);
    for (let i = 0; i < providerURLs.length; i++) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(providerURLs[i].url);
        await provider.getBlockNumber();
        return provider;
      } catch (error: any) {
        console.log(`Provider: ${providerURLs[i].name} not available`, error);
        continue;
      }
    }
    throw 'Invalid providers';
  }

  getAddresses(): ContractAddress {
    return ADDRESSES[this.configService.get('NETWORK_ID')];
  }
}
