import { withdrawalsResponseMock } from './data';

export const NumberOfTimesReceivedDataFromIndexerMock = 2;
// Each time this function is called inside the relayer service unit tests, we need to add new execution context
// Example: .mockReturnValueOnce(withdrawalsResponseMock).mockReturnValueOnce([])
export const IndexerServiceMock = {
  getWithdraws: jest
    .fn()
    // TestCase 1
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce([])
    // TestCase 2
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce([])
    // TestCase 3
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce([])
    // TestCase 4
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce([])
    // TestCase 5: Success processWithdrawals
    // this test will loop 2 times
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce([])
    .mockReturnValueOnce(withdrawalsResponseMock)
    .mockReturnValueOnce([]),
};
