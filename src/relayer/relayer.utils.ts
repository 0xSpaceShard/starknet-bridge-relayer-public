import { LoggerService } from '@nestjs/common';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const callWithRetry = async (logger: LoggerService, max: number, callback: Function, functionId: string) => {
  for (let i = 1; i <= max; i++) {
    try {
      return await callback();
    } catch (error) {
      sleep(3000);
      logger.log(`Retry: ${functionId}`, { index: i - 1 });
      if (i == max) {
        logger.error(`Retry failed: ${functionId} - ${error}`);
        throw `Error: ${functionId} - ${error}`;
      }
    }
  }
};
