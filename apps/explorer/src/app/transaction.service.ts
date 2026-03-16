import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { SiaClient } from 'sia-client';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Block } from 'database';

@Injectable()
export class TransactionService {
    private siaClient: SiaClient;
    private readonly logger = new Logger(TransactionService.name);

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectRepository(Block) private blockRepo: Repository<Block>
    ) {
        this.siaClient = new SiaClient();
    }

    async getTransaction(id: string): Promise<any> {
        const cacheKey = `tx_${id}`;
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) return cached;

        // 1. Try Upstream API first (Source of Truth)
        try {
            const tx = await this.siaClient.getTransaction(id);
            await this.cacheManager.set(cacheKey, tx, 86400000); // 24h TTL
            return tx;
        } catch (apiError) {
            this.logger.warn(`API search failed for tx ${id}, falling back to local DB: ${apiError.message}`);

            // 2. Fallback to Local DB
            try {
                const raw = await this.blockRepo.query(
                    `SELECT height, timestamp, tx FROM blocks, jsonb_array_elements(blocks.transactions) as tx WHERE tx->>'id' = $1`,
                    [id]
                );

                if (raw && raw.length > 0) {
                    const row = raw[0];
                    const tx = {
                        ...row.tx,
                        height: row.height,
                        timestamp: row.timestamp
                    };
                    await this.cacheManager.set(cacheKey, tx, 86400000); // 24h TTL
                    return tx;
                }
            } catch (dbError) {
                this.logger.error(`DB search also failed for tx ${id}: ${dbError.message}`);
            }

            // If both failed, rethrow the original API error or a 404
            throw apiError;
        }
    }

    async getRecentTransactions(limit = 50): Promise<any[]> {
        this.logger.log(`Entering getRecentTransactions limit=${limit}`);
        try {
            // 1. Get recent blocks with transactions
            const blocks = await this.blockRepo.find({
                order: { height: 'DESC' },
                take: limit,
                // Removed select to test if it causes issues
                // select: ['id', 'height', 'timestamp', 'transactions'] 
            });
            this.logger.log(`Found ${blocks.length} blocks`);

            const allTxs: any[] = [];
            const seenIds = new Set<string>();

            // 2. Flatten and Dedup
            for (const block of blocks) {
                const txs = block.transactions || [];
                for (const tx of txs) {
                    if (!seenIds.has(tx.id)) {
                        seenIds.add(tx.id);

                        // 3. Map / Enrich
                        allTxs.push({
                            id: tx.id,
                            height: block.height,
                            timestamp: block.timestamp,
                            type: this.deduceType(tx),
                            amount: this.calculateAmount(tx), // Will be 0 for now
                            fee: this.calculateFee(tx),
                            // Keep original data just in case
                            // ...tx 
                        });
                    }
                }
            }

            return allTxs;
        } catch (error) {
            this.logger.error(`CRITICAL TX ERROR: ${error.message}`, error.stack);
            throw error;
        }
    }

    private deduceType(tx: any): string {
        if (tx.fileContractResolutions && tx.fileContractResolutions.length > 0) {
            const type = tx.fileContractResolutions[0].type;
            if (type === 'storage_proof') return 'storage_proof';
            if (type === 'expiration') return 'contract_expiration';
            if (type === 'renewal') return 'contract_renewal';
            return 'storage_proof'; // Default fallback for resolution
        }
        if (tx.fileContracts && tx.fileContracts.length > 0) {
            return 'contract_formation';
        }
        if (tx.fileContractRevisions && tx.fileContractRevisions.length > 0) {
            return 'contract_revision';
        }
        if (tx.hostAnnouncements && tx.hostAnnouncements.length > 0) {
            return 'host_announcement';
        }
        // Check arbitrary data for announcements if not caught above
        if (tx.arbitraryData && tx.arbitraryData.length > 0) {
            // Decode base64 to check prefixes if necessary, but keep simple for now
        }

        // Default to transfer if no other specific type found
        return 'transfer';
    }

    private calculateAmount(tx: any): string {
        let total = 0n;
        // Sia V1 API uses camelCase: siacoinOutputs
        // Sia V2 API uses different structure with siacoinElements
        const outputs = tx.siacoinOutputs || tx.siacoin_outputs || [];
        if (outputs && Array.isArray(outputs)) {
            for (const out of outputs) {
                // Sia API returns value in hastings as a string
                // It may be nested: out.value, out.siacoinOutput?.value, out.siacoin_output?.value
                const raw = out.value ?? out.siacoinOutput?.value ?? out.siacoin_output?.value;
                if (raw) {
                    try { total += BigInt(raw); } catch { /* skip invalid */ }
                }
            }
        }
        // V2: siacoinElements also carry outputs with siacoinOutput.value
        const elements = tx.siacoinElements || [];
        if (elements && Array.isArray(elements)) {
            for (const el of elements) {
                const raw = el.siacoinOutput?.value ?? el.value;
                if (raw) {
                    try { total += BigInt(raw); } catch { /* skip invalid */ }
                }
            }
        }
        return total.toString();
    }

    private calculateFee(tx: any): string {
        let total = 0n;
        // V1: minerFees is an array of strings (hastings)
        const fees = tx.minerFees || tx.miner_fees || [];
        if (fees && Array.isArray(fees)) {
            for (const fee of fees) {
                try { total += BigInt(fee); } catch { /* skip invalid */ }
            }
        }
        return total.toString();
    }
}
