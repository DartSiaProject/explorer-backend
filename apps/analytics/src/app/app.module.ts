import { Module } from '@nestjs/common';
import { DatabaseModule, Host, HostMetric, Block } from 'database';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

import { SiaClient } from 'sia-client';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Host, HostMetric, Block]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SiaClient],
})
export class AppModule { }
