import { fromBlockNumberMock } from './data';

export const MongoServiceMock = {
  updateProcessedBlock: jest.fn((blockNumber: number) => {
    return {
      acknowledged: true,
    };
  }),
  getLastProcessedBlock: jest.fn(() => {
    return { id: '111111111111111111111111', blockNumber: fromBlockNumberMock };
  }),
};

export const MongoServiceMockData = {
  updateProcessedBlock: {
    ack: true,
    id: '111111111111111111111111',
  },
  getLastProcessedBlock: { id: '111111111111111111111111', blockNumber: fromBlockNumberMock },
};
