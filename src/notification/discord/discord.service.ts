import { HttpService } from '@nestjs/axios';
import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from 'common/config';
import { INotificationService } from 'notification/notification';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class DiscordService implements INotificationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
    private readonly httpService: HttpService,
  ) {}

  sendMessage = async (message: String) => {
    try {
      await lastValueFrom(this.httpService.post(this.configService.get('DISCORD_WEBHOOK_URL'), message));
    } catch (error) {
      this.loggerService.error('Error to send message to Discord', { error });
    }
  };
}
