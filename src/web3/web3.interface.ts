import { BigNumber } from "ethers";

export interface NetworkContractAddress {
  mainnet: ContractAddress;
  goerli: ContractAddress;
}

export interface ContractAddress {
  multicall: string;
  starknetCore: string;
}

export interface Provider {
  name: string;
  url: string;
}

export interface MulticallRequest {
  target: string;
  callData: string;
}

export interface MulticallResponse {
  blockNumber: BigNumber;
  returnData: string[];
}
