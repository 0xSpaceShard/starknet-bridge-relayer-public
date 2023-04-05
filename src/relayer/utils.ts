import { Transfer, Withdrawal } from 'indexer/entities';
import { uint256 } from 'starknet';
import { TRANSFER_FROM_STARKNET, l2BridgeAddressToL1 } from './relayer.constants';
import { ethers } from 'ethers';
import { MulticallRequest } from 'web3/web3.interface';

export const getMessageHash = (
  l2BridgeAddress: string,
  l1BridgeAddress: string,
  receiverL1: string,
  amount: string,
): string => {
  const amountUint256 = uint256.bnToUint256(amount.toString());
  const payload = [TRANSFER_FROM_STARKNET, receiverL1, amountUint256.low, amountUint256.high];
  return ethers.utils.solidityKeccak256(
    ['uint256', 'uint256', 'uint256', 'uint256[]'],
    [l2BridgeAddress, l1BridgeAddress, payload.length, payload],
  );
};
