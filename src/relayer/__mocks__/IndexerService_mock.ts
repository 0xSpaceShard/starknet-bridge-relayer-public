import { withdrawalsResponseMock } from './data';

export const NumberOfTimesReceivedDataFromIndexerMock = 2;
// Each time this function is called inside the relayer service unit tests, we need to add new execution context
// Example: .mockReturnValueOnce(withdrawalsResponseMock).mockReturnValueOnce([])

const totalWithdrawals = (count: number) => {
  const withdrawals = [];
  for (let i = 0; i < count; i++) {
    withdrawals.push(withdrawalsResponseMock[0]);
  }
  return withdrawals;
};

export const IndexerServiceMock = {
  getWithdraws: jest
    .fn()
    // TestCase 1
    .mockReturnValueOnce(totalWithdrawals(1000))
    .mockReturnValueOnce(totalWithdrawals(100))
    // TestCase 2
    .mockReturnValueOnce(totalWithdrawals(100))
    // TestCase 3
    .mockReturnValueOnce([])
    // TestCase 4
    .mockReturnValueOnce(withdrawalsResponseMock)
    // TestCase 5
    .mockReturnValueOnce(withdrawalsResponseMock)
    // TestCase 6
    .mockReturnValueOnce(withdrawalsResponseMock)
    // TestCase 7
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce(withdrawalsResponseMock),
};

// export const IndexerServiceMock = {
//   getWithdraws: () => {
//     const withdrawals = [];
//     for (let i = 0; i < 1000; i++) {
//       withdrawals.push(withdrawalsResponseMock[0]);
//     }
//     return withdrawals;
//   },
// };
