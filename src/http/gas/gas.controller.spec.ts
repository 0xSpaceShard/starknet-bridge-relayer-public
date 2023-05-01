import { Test, TestingModule } from '@nestjs/testing';
import { GasController } from './gas.controller';
import { GasService } from './gas.service';
import { ConfigService } from 'common/config';
import { createMock } from '@golevelup/ts-jest';
import { BigNumber } from 'ethers';
import { ServiceUnavailableException } from '@nestjs/common';

describe('GasController', () => {
  let controller: GasController;
  let gasService: GasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GasController],
      providers: [
        ConfigService,
        {
          provide: GasService,
          useValue: createMock(),
        },
      ],
    }).compile();

    controller = module.get<GasController>(GasController);
    gasService = module.get<GasService>(GasService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('Should return gas cost', async () => {
    const gasCost = BigNumber.from('29500000000000');
    jest.spyOn(gasService, 'getGasCostPerTimestamp').mockReturnValueOnce(Promise.resolve(gasCost));

    const timestamp = 1669087968;
    const res = await controller.getGasCostPerTimestamp(timestamp);
    expect(res.status).toEqual('ok');
    expect(res.message).toEqual('success');
    expect(res.result.gasCost).toEqual(gasCost.toString());
    expect(res.result.timestamp).toEqual(timestamp);
  });

  it('Should fail to return gas cost', async () => {
    const gasCost = BigNumber.from('29500000000000');
    jest
      .spyOn(gasService, 'getGasCostPerTimestamp')
      .mockImplementation(async (timestamp: number): Promise<BigNumber> => {
        throw new Error('Error to calculate gas cost');
      });

    const timestamp = 1669087968;
    try {
      await controller.getGasCostPerTimestamp(timestamp);
    } catch (error) {
      expect(error.status).toEqual(503);
    }
  });
});
