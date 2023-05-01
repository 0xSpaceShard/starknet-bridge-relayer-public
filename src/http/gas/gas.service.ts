import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { callWithRetry, sleep } from 'relayer/relayer.utils';
import { catchError, firstValueFrom } from 'rxjs';
import { BaseFeePerGasHistory } from 'web3/web3.interface';
import { Web3Service } from 'web3/web3.service';
import { BlockNumber24H, CacheDuration24hInMs, EtherscanApiUrl, GasCostPerWithdrawal } from './gas.constants';
import { AxiosError } from 'axios';
import { ConfigService } from 'common/config';
import { BigNumber } from 'ethers';
import { ceilBigNumber, clampTimestamp, roundBigNumber } from './gas.utils';
import { EtherscanGetBlockNumberTimestampResponse, FeeHistory } from './gas.interface';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class GasService {
  private readonly etherscanApiUrl: string;
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private web3Service: Web3Service,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly httpService: HttpService,
  ) {
    this.etherscanApiUrl = EtherscanApiUrl(this.configService.get('NETWORK_ID'));
  }

  getGasCostPerTimestamp = async (timestamp: number): Promise<BigNumber> => {
    const ctimestamp = clampTimestamp(timestamp);

    // Block number
    let blockNumber: number = Number((await this.cacheManager.get(String(ctimestamp))) || 0);
    if (!blockNumber) {
      blockNumber = await this.fetchBlockNumberByTimestamp(ctimestamp);
      this.logger.log('Fetch blockNumber', { blockNumber, ctimestamp, timestamp });
      await this.cacheManager.set(String(ctimestamp), blockNumber, CacheDuration24hInMs);
    }

    // base fees
    let gasCost: BigNumber = BigNumber.from(((await this.cacheManager.get(String(blockNumber))) as String) || '0');
    if (gasCost.gt(0)) {
      this.logger.log('Use in memory gas cost', { gasCost, blockNumber, ctimestamp, timestamp });
      return gasCost;
    }

    const feeHistory = await this.fetchBaseFeePriceHistory(
      blockNumber,
      blockNumber - this.getNumberOfBlocksToCalculateTheGasCost(),
    );

    gasCost = await this.calculateGasCost(feeHistory, GasCostPerWithdrawal);
    await this.cacheManager.set(String(blockNumber), gasCost.toString(), CacheDuration24hInMs);
    this.logger.log('Calculate gas cost', { gasCost, blockNumber, ctimestamp, timestamp });

    return gasCost;
  };

  calculateGasCost = async (feeHistory: FeeHistory, gasUnit: number): Promise<BigNumber> => {
    const averageGasPrice = this.getAverageGasPrice(feeHistory.baseFees);
    return this.getGasCost(averageGasPrice, gasUnit);
  };

  getGasCost = (averageGasPrice: BigNumber, gasUnit: number): BigNumber => {
    return averageGasPrice.mul(String(gasUnit));
  };

  getAverageGasPrice = (baseFeePriceHistoryList: Array<String>) => {
    let totalBaseFeePrice = BigNumber.from('0');
    for (let i = 0; i < baseFeePriceHistoryList.length; i++) {
      totalBaseFeePrice = totalBaseFeePrice.add(BigNumber.from(baseFeePriceHistoryList[i]));
    }
    const averageBaseGasPrice = roundBigNumber(totalBaseFeePrice.div(baseFeePriceHistoryList.length));
    const averageBaseGasPriceCeil = ceilBigNumber(averageBaseGasPrice);
    return averageBaseGasPriceCeil;
  };

  fetchBaseFeePriceHistory = async (lastBlockNumber: number, oldBlockNumber: number): Promise<FeeHistory> => {
    return await this.callWithRetry({
      callback: async () => {
        const feeHistory: FeeHistory = {
          lastBlock: lastBlockNumber,
          oldBlock: oldBlockNumber + 1,
          baseFees: [],
        };

        const limit = this.getLimit();
        const mod = oldBlockNumber % limit;
        let fromBlock = oldBlockNumber - mod + limit;
        const len = Math.ceil((lastBlockNumber - oldBlockNumber + mod) / limit);

        for (let i = 0; i < len; i++) {
          let baseFeePerGasHistory: BaseFeePerGasHistory = await this.cacheManager.get(String(fromBlock));
          if (!baseFeePerGasHistory?.baseFeePerGas) {
            this.logger.log('Fetch fee data', { lastBlockNumber, oldBlockNumber, fromBlock, limit });
            await sleep(500);
            baseFeePerGasHistory = await this.web3Service.fetchBaseFeePriceHistory(fromBlock, limit);
            await this.cacheManager.set(String(fromBlock), baseFeePerGasHistory, CacheDuration24hInMs);
          }
          const needtoClamp = baseFeePerGasHistory.baseFeePerGas.length != limit;
          const clampTo = needtoClamp ? -1 : baseFeePerGasHistory.baseFeePerGas.length;

          if (mod > 0 && i == 0) {
            feeHistory.baseFees.push(...baseFeePerGasHistory.baseFeePerGas.slice(mod, clampTo));
          } else if (mod > 0 && i == len - 1) {
            feeHistory.baseFees.push(
              ...baseFeePerGasHistory.baseFeePerGas.slice(
                0,
                this.getNumberOfBlocksToCalculateTheGasCost() - feeHistory.baseFees.length,
              ),
            );
          } else {
            feeHistory.baseFees.push(...baseFeePerGasHistory.baseFeePerGas.slice(0, clampTo));
          }
          fromBlock = fromBlock + limit;
        }

        if (feeHistory.baseFees.length !== lastBlockNumber - oldBlockNumber) {
          this.logger.error("Invalid Base gas data", {
            feeHistoryLength: feeHistory.baseFees.length,
            expectedLength: lastBlockNumber - oldBlockNumber,
          });
          throw new Error("Invalid Base gas data");
        }
        return feeHistory;
      },
      errorCallback: (error: any) => {
        this.logger.error('Error to get base fee price history:', error);
      },
    });
  };

  fetchBlockNumberByTimestamp = async (timestamp: number): Promise<number> => {
    return await this.callWithRetry({
      callback: async () => {
        await sleep(1000);
        const res = await firstValueFrom(
          this.httpService
            .get<EtherscanGetBlockNumberTimestampResponse>(
              `${
                this.etherscanApiUrl
              }?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=before&apikey=${this.configService.get(
                'ETHERSCAN_API_KEY',
              )}`,
            )
            .pipe(
              catchError((error: AxiosError) => {
                this.logger.error('Error to fetch block by timestamp', error.response.data);
                throw `Error to fetch block by timestamp, ${error.response.data}`;
              }),
            ),
        );

        if (res.status != 200) {
          this.logger.error('Error returned when fetch block by timestamp', res.data);
          throw `Error returned when fetch block by timestamp, ${res.data}`;
        }
        return Number(res.data.result);
      },
      errorCallback: (error: any) => {
        const errMessage = `Can not get data from etherscan api : ${error}`;
        this.logger.error(errMessage);
        throw errMessage;
      },
    });
  };

  async callWithRetry({ callback, errorCallback }: { callback: Function; errorCallback: Function }) {
    return await callWithRetry(3, 2000, callback, errorCallback);
  }

  getNumberOfBlocksToCalculateTheGasCost = (): number => {
    return BlockNumber24H;
  };

  getLimit = (): number => {
    return 1000;
  };
}
