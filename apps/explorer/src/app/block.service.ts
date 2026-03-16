import { Injectable, Inject } from '@nestjs/common';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { SiaClient } from 'sia-client';
import { BlockDto } from 'common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Block } from 'database'; // Assuming Block entity is also in common
import axios from 'axios';

@Injectable()
export class BlockService {
    private siaClient: SiaClient;

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        @InjectRepository(Block) private blockRepo: Repository<Block>
    ) {
        this.siaClient = new SiaClient();
    }

    async getTip(): Promise<BlockDto> {
        return this.siaClient.getTip(); // Direct proxy is fine for Tip
    }

    async getBlock(heightOrId: string | number): Promise<BlockDto> {
        // cache key distinguishes types
        const cacheKey = `block_${heightOrId}`;
        const cached = await this.cacheManager.get<BlockDto>(cacheKey);
        if (cached) return cached;

        let blockId = '';

        if (!isNaN(Number(heightOrId))) {
            // It's a height
            const h = Number(heightOrId);
            const blockHeader = await this.blockRepo.findOne({ where: { height: h } });

            if (blockHeader) {
                blockId = blockHeader.id;
            } else {
                // Not in DB, try external API chain index
                try {
                    console.log(`Block ${h} not in DB, fetching chain index...`);
                    const index = await this.siaClient.getChainIndex(h);
                    blockId = index.id;
                } catch (e) {
                    throw new Error(`Block at height ${h} not found in DB or API.`);
                }
            }
        } else {
            // It's likely a Hash ID
            blockId = String(heightOrId);
        }

        // Fetch Full Data via ID
        const block = await this.siaClient.getBlockById(blockId);

        // Normalize V2 transactions for frontend
        if (block.v2?.transactions && (!block.transactions || block.transactions.length === 0)) {
            block.transactions = block.v2.transactions;
        }

        // Create response with transactionsCount (frontend expects this property)
        const tCount = block.transactions?.length || block.transactionCount || 0;
        console.log(`[DEBUG] Block ${blockId} - Transactions Length: ${block.transactions?.length}, tCount: ${tCount}`);

        const blockWithCount: BlockDto = {
            ...block,
            transactionsCount: tCount
        };
        console.log(`[DEBUG] Returning blockWithCount.transactionsCount: ${blockWithCount.transactionsCount}`);

        await this.cacheManager.set(cacheKey, blockWithCount, 3600000);
        return blockWithCount;
    }

    private mapToDto(b: Block): any {
        // Calculate fees/reward from minerPayouts
        let fees = 0;
        let miner = 'Unknown';

        if (b.minerPayouts && Array.isArray(b.minerPayouts)) {
            // Sum values (in Hastings) and convert to SC (10^24)
            // Using logic: val / 1e24
            const totalHastings = b.minerPayouts.reduce((sum: number, p: any) => {
                const val = p.siacoinOutput?.value || p.value || 0;
                return sum + Number(val);
            }, 0);
            fees = totalHastings / 1e24;

            if (b.minerPayouts.length > 0) {
                const first = b.minerPayouts[0];
                miner = first.siacoinOutput?.address || first.unlockHash || first.address || 'Unknown';
            }
        }

        return {
            height: b.height,
            id: b.id,
            timestamp: b.timestamp.toISOString(),
            transactionsCount: b.transactionCount, // Map to frontend prop (plural)
            minerPayouts: b.minerPayouts || [],
            difficulty: '0',
            totalCoins: '0',
            previousBlockId: b.id, // Placeholder or parent mapping
            parentID: '',
            fees, // Calculated fee in SC
            miner,
            size: 0, // Not stored
        };
    }

    async getBlocks(page: number = 1, limit: number = 20): Promise<BlockDto[]> {
        // DB-first approach for listing
        const skip = (page - 1) * limit;
        const blocks = await this.blockRepo.find({
            order: { height: 'DESC' },
            take: limit,
            skip: skip
        });

        return blocks.map(b => this.mapToDto(b));
    }

    async getBlockStats(): Promise<import('common').BlockStatsDto> {
        console.log('[DEBUG] getBlockStats called');
        try {
            // 1. Get Consensus State for Difficulty & Times
            console.log('[DEBUG] Fetching consensus state...');
            const state = await this.siaClient.getConsensusState();
            console.log('[DEBUG] State received:', JSON.stringify(state));

            const difficulty = BigInt(state.difficulty || 0);
            console.log('[DEBUG] Difficulty:', difficulty.toString());

            // Calculate Hashrate: Difficulty / 600s
            // JS doesn't support big int division returning float, so convert carefully
            // 1 PH/s = 1e15. 
            // hashrate = diff / 600.
            const hashrate = Number(difficulty / 600n);
            console.log('[DEBUG] Hashrate:', hashrate);

            // Calculate Avg Block Time (from prevTimestamps)
            let avgTime = 600; // default 10m
            if (state.prevTimestamps && state.prevTimestamps.length > 1) {
                const times = state.prevTimestamps.map((t: string) => new Date(t).getTime() / 1000);
                // Sort just in case
                times.sort((a: number, b: number) => a - b);

                let totalDiff = 0;
                for (let i = 1; i < times.length; i++) {
                    totalDiff += (times[i] - times[i - 1]);
                }
                avgTime = totalDiff / (times.length - 1);
            }
            console.log('[DEBUG] AvgTime:', avgTime);

            // 2. Calculate Avg Fees (from DB)
            console.log('[DEBUG] Fetching recent blocks from DB...');
            const recentBlocks = await this.blockRepo.find({
                order: { height: 'DESC' },
                take: 20
            });
            console.log('[DEBUG] Recent blocks count:', recentBlocks.length);

            let avgFees = 0;
            if (recentBlocks.length > 0) {
                const totalFees = recentBlocks.reduce((sum, b) => {
                    const dto = this.mapToDto(b);
                    return sum + dto.fees;
                }, 0);
                avgFees = totalFees / recentBlocks.length;
            }
            console.log('[DEBUG] AvgFees:', avgFees);

            const result = {
                height: state.index?.height || 0,
                difficulty: difficulty.toString(),
                hashrate,
                averageBlockTime: avgTime,
                averageBlockFees: avgFees
            };
            console.log('[DEBUG] Result:', JSON.stringify(result));
            return result;

        } catch (e) {
            console.error("Failed to get block stats:", e);
            // Log the actual error object attributes if possible
            if (e instanceof Error) {
                console.error("Error message:", e.message);
                console.error("Error stack:", e.stack);
            }
            throw new Error("Could not fetch block stats");
        }
    }

    async searchBlock(query: string): Promise<BlockDto | null> {
        if (!query) return null;

        let result: BlockDto | null = null;

        // 1. Try Local DB / Local Node
        if (!isNaN(Number(query))) {
            try {
                result = await this.getBlock(Number(query));
            } catch (e) {
                console.warn(`[Search] Local lookup failed for height ${query}:`, e.message);
            }
        } else {
            try {
                result = await this.getBlock(query);
            } catch (e) {
                console.warn(`[Search] Local lookup failed for hash ${query}:`, e.message);
            }
        }

        if (result) return result;

        // 2. Fallback: External Explorer API (Sia Graph or similar)
        const exploredApi = process.env.SIA_EXPLORED_API || 'https://explorer.siagraph.info';
        try {
            console.log(`[Search] Local lookup failed for '${query}'. Trying external: ${exploredApi}`);
            // Try as block (works for height or hash usually on some APIs)
            // Or use /api/explorer/hashes for hash
            const url = !isNaN(Number(query))
                ? `${exploredApi}/api/explorer/blocks/${query}`
                : `${exploredApi}/api/explorer/hashes/${query}`;

            const { data } = await axios.get(url, { timeout: 5000 });

            // Validate response type.
            if (data && (data.block || data.height || data.transaction)) {
                if (data.block) return data.block;
                if (data.type === 'block') return data.block;
                return data;
            }
        } catch (e) {
            // Don't crash on external API failures (404, timeout, etc.)
            if (axios.isAxiosError(e)) {
                console.warn(`[Search] External lookup failed for '${query}': ${e.response?.status || e.code} ${e.message}`);
            } else {
                console.warn(`[Search] External lookup error for '${query}':`, e.message);
            }
        }

        return null;
    }
}
