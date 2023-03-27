import { Module } from '@nestjs/common';
import { RelayerService } from './relayer.service';
import { ConfigModule } from '@nestjs/config';
import { Web3Module } from 'web3/web3.module';
import { MongoModule } from 'storage/mongo/mongo.module';
import { IndexerModule } from 'indexer/indexer.module';

@Module({
  imports: [ConfigModule, Web3Module, MongoModule, IndexerModule],
  providers: [RelayerService],
})
export class RelayerModule {}
