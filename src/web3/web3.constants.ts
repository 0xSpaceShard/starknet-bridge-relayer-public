import { NetworkContractAddress } from './web3.interface';
import { ConfigService } from 'common/config';
import { Provider } from './web3.interface';

export const ADDRESSES: NetworkContractAddress = {
  mainnet: {
    multicall: '0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441',
    starknetCore: '0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4',
  },
  goerli: {
    multicall: '0x77dCa2C955b15e9dE4dbBCf1246B4B85b651e50e',
    starknetCore: '0xde29d060D45901Fb19ED6C6e959EB22d8626708e',
  },
};

export const getProviderURLs = (configs: ConfigService): Array<Provider> => {
  return [
    { name: 'alchemy', url: configs.get('ALCHEMY_API_KEY') },
    { name: 'infura', url: configs.get('INFURA_API_KEY') },
  ];
};
