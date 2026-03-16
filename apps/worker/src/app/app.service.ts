import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppService.name);

  constructor(
    @InjectQueue('ingestion') private ingestionQueue: Queue,
    @InjectQueue('block-ingestion') private blockQueue: Queue
  ) { }

  async onApplicationBootstrap() {
    this.logger.log('Initializing Job Scheduler...');

    // Clean existing repeatable jobs to avoid duplicates on restart
    await this.cleanOldJobs();

    // 1. Host Sync - Analyzes hosts (triggered recursively by processor)
    await this.ingestionQueue.add(
      'host-sync',
      {},
      {
        jobId: 'host-sync-initial' // Initial run only
      }
    );

    // ... block sync ...
    await this.blockQueue.add(
      'block-sync',
      {},
      {
        repeat: {
          every: 10000,
        },
        jobId: 'block-sync-periodic'
      }
    );

    this.logger.log('Jobs scheduled successfully.');
  }

  private async cleanOldJobs() {
    const repeatableJobs = await this.ingestionQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.ingestionQueue.removeRepeatableByKey(job.key);
    }

    const blockJobs = await this.blockQueue.getRepeatableJobs();
    for (const job of blockJobs) {
      await this.blockQueue.removeRepeatableByKey(job.key);
    }
  }

  getData(): { message: string } {
    return { message: 'Hello API' };
  }
}
