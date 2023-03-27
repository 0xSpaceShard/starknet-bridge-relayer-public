export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const callWithRetry = async (retries: number, delay: number, callback: Function, errorCallback: Function) => {
  for (let i = 1; i <= retries; i++) {
    try {
      return await callback();
    } catch (error: any) {
      sleep(delay);
      if (i == retries) {
        errorCallback(error);
      }
    }
  }
};
