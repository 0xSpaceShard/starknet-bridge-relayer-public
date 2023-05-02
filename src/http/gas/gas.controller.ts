import { Controller, Get, Param, ServiceUnavailableException } from '@nestjs/common';
import { GasService } from './gas.service';
import { ConfigService } from 'common/config';

@Controller({
  path: 'gas-cost',
  version: '1',
})
export class GasController {
  constructor(private gasService: GasService, private configService: ConfigService) {}

  @Get(':timestamp')
  async getGasCostPerTimestamp(@Param("timestamp") timestamp: number) {
    try {
      const gasCost = (await this.gasService.getGasCostPerTimestamp(timestamp)).toString();
      return {
        status: 'ok',
        message: 'success',
        result: {
          gasCost,
          timestamp,
          relayerAddress: this.configService.get('RELAYER_L2_ADDRESS'),
        },
      };
    } catch (error) {
      throw new ServiceUnavailableException();
    }
  }
}
