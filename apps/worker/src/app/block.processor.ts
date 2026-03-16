import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiaClient } from 'sia-client';
import { Block, SyncState } from 'database';

@Processor('block-ingestion')
@Injectable()
export class BlockIngestionProcessor extends WorkerHost {
    private readonly logger = new Logger(BlockIngestionProcessor.name);

    constructor(
        private readonly siaClient: SiaClient,
        @InjectRepository(Block)
        private readonly blockRepo: Repository<Block>,
        @InjectRepository(SyncState)
        private readonly syncRepo: Repository<SyncState>,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        this.logger.log(`Processing block job: ${job.name} (ID: ${job.id})`);
        if (job.name === 'block-sync') {
            try {
                await this.syncBlocks();
            } catch (error) {
                this.logger.error(`Block Sync Failed: ${error.message}`, error.stack);
                throw error;
            }
        } else {
            this.logger.warn(`Unknown block job name: ${job.name}`);
        }
    }

    private async syncBlocks() {
        this.logger.log('Starting block sync (Backward Tip-Following)...');

        // 1. Get Chain Tip
        const tip = await this.siaClient.getTip();
        this.logger.log(`Chain Tip: Height ${tip.height}, ID ${tip.id}`);

        let currentId = tip.id;
        let syncedCount = 0;

        // Batch size not applicable for linked-list traversal, but we use a limit to allow yielding
        const maxDepth = 1000; // Sync 1000 blocks per job for faster optimization

        for (let i = 0; i < maxDepth; i++) {
            // Optimization: Check if block already exists
            // Optimization: Check if block already exists
            const existing = await this.blockRepo.findOne({ where: { id: currentId } });
            if (existing) {
                this.logger.debug(`Block ${existing.height} (${currentId}) exists. checking for history gaps...`);

                // Switch to History Backfill Mode
                // Find the lowest block we have
                const lowest = await this.blockRepo.find({ order: { height: 'ASC' }, take: 1 });

                if (lowest.length > 0 && lowest[0].height > 0) {
                    // Fetch lowest block to get its parent (prevBlock)
                    // We can't rely on existing variable here because it might be a block near tip
                    if (lowest[0].id === currentId && existing.height > 0) {
                        // We just processed this one or matched it. 
                        // Check if we need to go deeper (already checked height > 0)
                    }

                    try {
                        const lowestBlockData = await this.siaClient.getBlockById(lowest[0].id);
                        currentId = lowestBlockData.parentID;
                        this.logger.debug(`Jumping to history gap: ${lowest[0].height} -> ${currentId}`);
                        continue; // Continue the loop with new currentId
                    } catch (e) {
                        this.logger.error('Failed to jump to history', e);
                        break;
                    }
                } else {
                    this.logger.log('Reached Genesis or DB empty. Sync complete.');
                    break;
                }
            }

            try {
                // Fetch Block
                const blockData = await this.siaClient.getBlockById(currentId);

                // Upsert
                const block = this.blockRepo.create({
                    height: blockData.height,
                    id: blockData.id || currentId,
                    timestamp: new Date(blockData.timestamp),
                    transactionCount: blockData.transactionCount ||
                        (blockData.v2?.transactions ? blockData.v2.transactions.length : 0) ||
                        (blockData.transactions ? blockData.transactions.length : 0),
                    minerPayouts: blockData.minerPayouts || {},
                    transactions: blockData.transactions || blockData.v2?.transactions || [],
                });
                await this.blockRepo.save(block);
                syncedCount++;

                // Move backwards
                if (blockData.height === 0) {
                    this.logger.log('Reached Genesis Block.');
                    break;
                }
                currentId = blockData.parentID;

            } catch (error) {
                this.logger.error(`Failed to ingest block ${currentId}`, error);
                // If specific block fails, we can't continue chain. Stop and retry later.
                throw error;
            }
        }

        if (syncedCount > 0) {
            this.logger.log(`Synced ${syncedCount} blocks (latest ${tip.height}).`);
        }
    }
}
