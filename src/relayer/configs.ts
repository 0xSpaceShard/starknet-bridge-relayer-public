export interface NetworkConfig {
  sleepAfterSuccessExec: number;
  sleepAfterFailExec: number;
  chunk: number;
}

export const getNetworkConfig = (network: string): NetworkConfig => {
  switch (network) {
    case 'mainnet':
      return {
        sleepAfterSuccessExec: 3600000,
        sleepAfterFailExec: 300000,
        chunk: 50,
      };
    default:
      // testnet
      return {
        sleepAfterSuccessExec: 3600000,
        sleepAfterFailExec: 300000,
        chunk: 50,
      };
  }
};
