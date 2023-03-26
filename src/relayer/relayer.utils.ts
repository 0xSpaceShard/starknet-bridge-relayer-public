export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const callWithRetry = async (max: number, callback: Function, errorMsg: string) => {
  for (let i = 1; i <= max; i++) {
    try {
      return await callback();
    } catch (error) {
        sleep(3000);
      if (i == max) {
        throw `${errorMsg}: ${error}`;
      }
    }
  }
};
