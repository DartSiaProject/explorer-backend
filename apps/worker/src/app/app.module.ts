import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule, Block, SyncState, Host, HostMetric } from 'database'; // Using lib alias
import { SiaClient } from 'sia-client';
import { BlockIngestionProcessor } from './block.processor';
import { HostScanProcessor } from './host.processor';
import { AppService } from './app.service';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Block, SyncState, Host, HostMetric]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    BullModule.registerQueue({
      name: 'ingestion',
    }),
    BullModule.registerQueue({
      name: 'block-ingestion',
    }),
  ],
  providers: [BlockIngestionProcessor, HostScanProcessor, SiaClient, AppService],
})
export class AppModule { }
