import { NetworkContractAddress } from './web3.interface';
import { ConfigService } from 'common/config';
import { Provider } from './web3.interface';

export const ADDRESSES: NetworkContractAddress = {
  mainnet: {
    multicall: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    multicallGasLimit: '0x3BEc1Fc3556cbdfd9Ebf9Ff398EF0434f1D7aD03',
    starknetCore: '0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4',
  },
  goerli: {
    multicall: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    multicallGasLimit: '0x07A9972b776Baf24DC9b2E3f7C55Da53e4F653CF',
    starknetCore: '0xde29d060D45901Fb19ED6C6e959EB22d8626708e',
  },
};

export const getProviderURLs = (configs: ConfigService): Array<Provider> => {
  return [
    { name: 'alchemy', url: configs.get('ALCHEMY_RPC_URL') },
    { name: 'infura', url: configs.get('INFURA_RPC_URL') },
  ];
};

export const GAS_BUFFER_PER_WITHDRAWAL = 15000

export const getRelayerAddress = (networkId: string) => {
  switch (networkId) {
    case "mainnet":
      return "0x06e02b62E101b44382D030d7aeE5528Bf65eed13D3B2D5Da3DFA883a2e1CE5f7"
    default:
      return "0x027f237537479fd27551379d1acc58f5448386a7094aac9b269e5d57aaf9d8c7"
  }
}

export const getNetworkEthAddress = (networkId: string) => {
  switch (networkId) {
    case "mainnet":
      return "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    default:
      return "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
  }
}
