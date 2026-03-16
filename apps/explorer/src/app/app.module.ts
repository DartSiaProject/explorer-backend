import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { BlockController } from './block.controller';
import { BlockService } from './block.service';
import { HostController } from './host.controller';
import { HostService } from './host.service';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';

import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule, Block, Host } from 'database';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Block, Host]),
    CacheModule.register({
      isGlobal: true,
      ttl: 5000,
      max: 100,
    }),
  ],
  controllers: [BlockController, HostController, TransactionController],
  providers: [BlockService, HostService, TransactionService],
})
export class AppModule { }
