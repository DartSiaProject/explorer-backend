import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Raw, Not, IsNull } from 'typeorm';
import { Host, Block, HostMetric } from 'database';
import { SiaClient } from 'sia-client';

@Injectable()
export class AnalyticsService {
    constructor(
        @InjectRepository(Host) private readonly hostRepo: Repository<Host>,
        @InjectRepository(Block) private readonly blockRepo: Repository<Block>,
        @InjectRepository(HostMetric) private readonly metricRepo: Repository<HostMetric>,
        private readonly siaClient: SiaClient
    ) {
        // Analytics Service Initialized
    }

    async getNetworkStats() {
        // 1. Total Scanned Hosts (DB)
        const dbTotalHosts = await this.hostRepo.count();

        // 2. Active Hosts (aligned with Host List logic)
        // Filter: Must have a score (implies scanned, active, and meeting criteria)
        const activeHostsList = await this.hostRepo.find({
            where: {
                score: Not(IsNull())
            }
        });

        // 3. Fetch Network Metrics from API (for Total Known Hosts count)
        let totalKnownHosts = 0;
        try {
            const apiMetrics = await this.siaClient.getNetworkMetrics();
            totalKnownHosts = Number(apiMetrics.activeHosts || 0);
        } catch (error) {
            console.error('Failed to fetch total hosts from API', error);
        }

        // Calculate Storage Usage from our Scanned Active Hosts (more accurate)
        let totalNetworkStorage = 0;
        let usedNetworkStorage = 0;
        let totalPrice = 0;
        let priceCount = 0;
        const debugLog: any[] = [];
        const SECTOR_SIZE = 4194304;

        for (const h of activeHostsList) {
            const v2 = h.v2Settings;
            const v1 = h.settings;

            let t = Number(v2?.totalStorage || v1?.totalstorage || 0);
            let r = Number(v2?.remainingStorage || v1?.remainingstorage || 0);

            // Debug sample first 5
            if (t > 0 && debugLog.length < 5) {
                debugLog.push({
                    pk: h.publicKey.substring(0, 5),
                    t: t,
                    r: r,
                    calcUsed: Math.max(0, t - r)
                });
            }

            // Convert sectors to bytes heuristic
            if (t > 0 && t < 100 * 1024 * 1024 * 1024) {
                t *= SECTOR_SIZE;
                r *= SECTOR_SIZE;
            }

            if (t > 0) {
                totalNetworkStorage += t;
                usedNetworkStorage += Math.max(0, t - r);
            }

            let price = 0;
            if (v2?.prices?.storagePrice) price = parseFloat(v2.prices.storagePrice);
            else if (v1?.storageprice) price = parseFloat(v1.storageprice);

            if (price > 0) {
                // Convert Hastings/Byte/Block to SC/TB/Month
                // Factor: 4320 blocks/mo * 1e12 bytes/TB * 1e-24 SC/Hastings = 4.32e-9
                const priceInSC = price * 4320 * 1e-12;
                totalPrice += priceInSC;
                priceCount++;
            }
        }

        // Use our local values overrides
        const total = totalNetworkStorage;
        const used = usedNetworkStorage;
        let finalAvgStoragePrice = priceCount > 0 ? (totalPrice / priceCount) : 0;
        finalAvgStoragePrice = Number(finalAvgStoragePrice.toFixed(2));

        if (finalAvgStoragePrice === 0) {
            try {
                const { avg } = await this.metricRepo
                    .createQueryBuilder('m')
                    .select('AVG(m.storagePrice)', 'avg')
                    .where('m.time > :time', { time: new Date(Date.now() - 24 * 60 * 60 * 1000) })
                    .andWhere('m.storagePrice > 0')
                    .getRawOne();
            } catch (e) {
                console.error('Failed to calc avg from DB', e);
            }
        }

        const tip = await this.blockRepo.findOne({
            order: { height: 'DESC' },
            where: {}
        });

        return {
            totalHosts: totalKnownHosts > 0 ? totalKnownHosts : dbTotalHosts,
            activeHosts: activeHostsList.length,
            usedStorage: used.toString(),
            totalStorage: total.toString(),
            avgStoragePrice: finalAvgStoragePrice,
            blockHeight: tip?.height || 0,
            lastBlockTime: tip?.timestamp,
            // @ts-ignore
            debug: debugLog
        };
    }

    async getTopHosts(limit: number = 50) {
        // Only return scored/active hosts (consistent with worker filter)
        return this.hostRepo.find({
            where: {
                score: Not(IsNull())
            },
            order: { score: 'DESC' },
            take: limit
        });
    }

    async getNetworkHistory(period: '24h' | '30d' = '24h') {
        try {
            const limitTimestamp = period === '24h'
                ? new Date(Date.now() - 24 * 60 * 60 * 1000)
                : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // 1. Host Metrics History
            const metricsQuery = `
                SELECT 
                    date_trunc('${period === '24h' ? 'hour' : 'day'}', m."time") as bucket,
                    COUNT(DISTINCT m."hostPublicKey") as "activeHosts",
                    SUM(m."remainingStorage") as "totalStorage",
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m."storagePrice") as "storagePrice"
                FROM host_metrics m
                WHERE m."time" > $1
                AND m."storagePrice" > 0
                GROUP BY 1
                ORDER BY 1 ASC
            `;

            const metricsData = await this.metricRepo.query(metricsQuery, [limitTimestamp]);

            // 2. Transaction Volume History
            const txQuery = `
                SELECT 
                    date_trunc('${period === '24h' ? 'hour' : 'day'}', "timestamp") as bucket,
                    SUM("transactionCount") as "transactionVolume"
                FROM blocks
                WHERE "timestamp" > $1
                GROUP BY 1
                ORDER BY 1 ASC
            `;

            const txData = await this.blockRepo.query(txQuery, [limitTimestamp]);

            return {
                metrics: metricsData.map((m: any) => ({
                    timestamp: m.bucket,
                    activeHosts: Number(m.activeHosts) || 0,
                    totalStorage: m.totalStorage,
                    storagePrice: Number(m.storagePrice) || 0
                })),
                transactions: txData.map((t: any) => ({
                    timestamp: t.bucket,
                    transactionVolume: Number(t.transactionVolume) || 0
                }))
            };
        } catch (error) {
            console.error('ERROR in getNetworkHistory:', error);
            throw error;
        }
    }

    async getHostHistory(publicKey: string) {
        return this.metricRepo.find({
            where: {
                // @ts-ignore
                host: { publicKey }
            },
            order: { time: 'ASC' },
            take: 100
        });
    }
}
