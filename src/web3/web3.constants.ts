import { NetworkContractAddress } from './web3.interface';
import { ConfigService } from 'common/config';
import { Provider } from './web3.interface';

export const ADDRESSES: NetworkContractAddress = {
  mainnet: {
    multicall: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    starknetCore: '0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4',
  },
  goerli: {
    multicall: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    starknetCore: '0xde29d060D45901Fb19ED6C6e959EB22d8626708e',
  },
};

export const getProviderURLs = (configs: ConfigService): Array<Provider> => {
  return [
    { name: 'alchemy', url: configs.get('ALCHEMY_RPC_URL') },
    { name: 'infura', url: configs.get('INFURA_RPC_URL') },
  ];
};

export const GAS_LIMIT_PER_WITHDRAWAL = 100000
export const GAS_LIMIT_MULTIPLE_WITHDRAWAL = 50000
