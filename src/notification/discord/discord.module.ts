import { Module } from '@nestjs/common';
import { DiscordService } from './discord.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from 'common/config';
import { LoggerModule } from 'common/logger';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
  ],
  providers: [DiscordService],
})
export class DiscordModule {}
