export interface NetworkConfig {
  sleepAfterSuccessExec: number;
  sleepAfterFailExec: number;
  chunk: number;
}

export const getNetworkConfig = (network: string): NetworkConfig => {
  switch (network) {
    case 'mainnet':
      return {
        sleepAfterSuccessExec: 28800000,
        sleepAfterFailExec: 600000,
        chunk: 50,
      };
    default:
      // testnet
      return {
        sleepAfterSuccessExec: 28800000,
        sleepAfterFailExec: 600000,
        chunk: 50,
      };
  }
};
