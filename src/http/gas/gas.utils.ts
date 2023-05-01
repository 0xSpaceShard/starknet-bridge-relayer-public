import { BigNumber } from 'ethers';
import { CheckPointSizeMs, FiveGwei, OneGwei } from './gas.constants';

export const roundBigNumber = (input: BigNumber): BigNumber => {
  return input.div(OneGwei).mul(OneGwei);
};

export const ceilBigNumber = (input: BigNumber): BigNumber => {
  return input.sub(input.mod(FiveGwei)).add(FiveGwei);
};

export const clampTimestamp = (timestamp: number): number => {
  return timestamp - (timestamp % CheckPointSizeMs) - CheckPointSizeMs;
};
