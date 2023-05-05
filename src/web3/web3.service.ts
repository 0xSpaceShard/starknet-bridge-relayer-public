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
import { ADDRESSES, GAS_LIMIT_MULTIPLE_WITHDRAWAL, GAS_LIMIT_PER_WITHDRAWAL, getProviderURLs } from './web3.constants';
import { ConfigService } from 'common/config';
import { BigNumber, ethers } from 'ethers';
import { BaseFeePerGasHistory, ContractAddress, MulticallRequest, Provider } from './web3.interface';
import * as StarknetCoreABI from './abis/StarknetCore.json';
import * as StarknetTokenBridgeABI from './abis/StarknetTokenBridge.json';

@Injectable()
export class Web3Service {
  maxPriorityFeePerGas: number;
  constructor(private configService: ConfigService) {
    this.maxPriorityFeePerGas = this.configService.get('MAX_PRIORITY_FEE_PER_GAS');
  }

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
    const length = multicallRequests.length;
    return await multicall.tryAggregate(false, multicallRequests, {
      maxPriorityFeePerGas: this.maxPriorityFeePerGas,
      gasLimit: GAS_LIMIT_PER_WITHDRAWAL + (length === 1 ? 0 : GAS_LIMIT_MULTIPLE_WITHDRAWAL * length),
    });
  }

  async callWithdraw(bridgeAddress: string, amount: BigNumber, receiverL1: string) {
    const starknetTokenBridge = await this.getStarknetTokenBridgeContract(bridgeAddress);
    return await starknetTokenBridge.withdraw(amount, receiverL1, { maxPriorityFeePerGas: this.maxPriorityFeePerGas });
  }

  async canConsumeMessageOnL1MulticallView(multicallRequests: Array<MulticallRequest>) {
    const multicallView = await this.getMulticallViewContract();
    return await multicallView.tryAggregate(false, multicallRequests);
  }

  async getStateBlockNumber(): Promise<BigNumber> {
    const starknetCore = await this.getStarknetCoreContract();
    return await starknetCore.stateBlockNumber();
  }

  encodeCalldataStarknetCore = (functionName: string, params: any[]): string => {
    let iface = new ethers.utils.Interface(StarknetCoreABI);
    return iface.encodeFunctionData(functionName, params);
  };

  encodeBridgeToken = (functionName: string, params: any[]): string => {
    let iface = new ethers.utils.Interface(StarknetTokenBridgeABI);
    return iface.encodeFunctionData(functionName, params);
  };

  fetchBaseFeePriceHistory = async (blockNumber: number, numberOfBlocks: number): Promise<BaseFeePerGasHistory> => {
    const provider = (await this.getProvider()).provider as ethers.providers.JsonRpcProvider;
    const baseFeePerGasHistoryList: BaseFeePerGasHistory = await provider.send('eth_feeHistory', [
      numberOfBlocks,
      BigNumber.from(blockNumber).toHexString().replace("0x0", "0x"),
      [],
    ]);
    return baseFeePerGasHistoryList;
  };

  getCurrentBlockNumber = async (): Promise<number> => {
    const provider = (await this.getProvider()).provider as ethers.providers.JsonRpcProvider;
    return await provider.getBlockNumber();
  };

  getCurrentGasPrice = async (): Promise<BigNumber> => {
    const provider = (await this.getProvider()).provider as ethers.providers.JsonRpcProvider;
    return await provider.getGasPrice();
  };

  getRelayerL1Balance = async (): Promise<BigNumber> => {
    const wallet = await this.getProvider();
    return await wallet.provider.getBalance(wallet.address);
  };

  async getProvider() {
    const providerURLs: Array<Provider> = getProviderURLs(this.configService);
    for (let i = 0; i < providerURLs.length; i++) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(providerURLs[i].url);
        await provider.getBlockNumber();
        return new ethers.Wallet(this.configService.get('PRIVATE_KEY'), provider);
      } catch (error: any) {
        continue;
      }
    }
    throw 'Invalid providers';
  }

  getAddresses(): ContractAddress {
    return ADDRESSES[this.configService.get('NETWORK_ID')];
  }
}
