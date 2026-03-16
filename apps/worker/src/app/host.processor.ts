import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiaClient } from 'sia-client';
import { Host, HostMetric, SyncState } from 'database';
import * as geoip from 'geoip-lite';

@Processor('ingestion')
@Injectable()
export class HostScanProcessor extends WorkerHost {
    private readonly logger = new Logger(HostScanProcessor.name);

    // Scoring Weights (Configurable)
    private readonly W_UPTIME = parseFloat(process.env.SCORE_WEIGHT_UPTIME || '0.4');
    private readonly W_PRICE = parseFloat(process.env.SCORE_WEIGHT_PRICE || '0.4');
    private readonly W_AGE = parseFloat(process.env.SCORE_WEIGHT_AGE || '0.2');

    private parseNumeric(val: any, defaultVal: number): number {
        if (val === undefined || val === null) return defaultVal;
        const parsed = parseFloat(val);
        return isNaN(parsed) ? defaultVal : parsed;
    }

    constructor(
        private readonly siaClient: SiaClient,
        @InjectRepository(Host)
        private readonly hostRepo: Repository<Host>,
        @InjectRepository(HostMetric)
        private readonly metricRepo: Repository<HostMetric>,
        @InjectQueue('ingestion') private ingestionQueue: Queue,
    ) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        this.logger.log(`Processing job: ${job.name} (ID: ${job.id})`);
        if (job.name === 'host-sync') {
            await this.syncHosts(job);
        } else {
            this.logger.warn(`Unknown job name: ${job.name}`);
        }
    }

    private async syncHosts(job: Job) {
        this.logger.log('Starting host sync & scoring...');
        let offset = 0;
        const limit = 500;
        let successCount = 0;
        let totalFetched = 0;
        const now = new Date(); // Scan start time (constant for entire scan)

        while (true) {
            let hosts;
            let retries = 3;

            while (retries > 0) {
                try {
                    // Throttling: Delay 1s between batches to avoid overwhelming the server/socket
                    if (offset > 0) await new Promise(resolve => setTimeout(resolve, 1000));

                    this.logger.log(`Fetching hosts batch offset=${offset}...`);
                    hosts = await this.siaClient.getHosts(offset, limit);
                    break; // Success
                } catch (error) {
                    retries--;
                    this.logger.warn(`Failed to fetch hosts (offset=${offset}). Retries left: ${retries}. Error: ${error.message}`);
                    if (retries === 0) {
                        this.logger.error('Max retries reached for batch. Aborting sync.', error);
                        throw error;
                    }
                    // Wait before retry (exponential backoff: 2s, 4s, 8s)
                    const waitTime = 2000 * (3 - retries);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }

            if (!hosts || hosts.length === 0) {
                break; // No more hosts
            }

            totalFetched += hosts.length;

            for (const data of hosts) {
                // Strict Validation: Skip if no public key
                if (!data.publicKey) {
                    this.logger.warn(`Skipping host with missing public key: ${JSON.stringify(data)}`);
                    continue;
                }

                // 1. Upsert Host Registry
                let host = await this.hostRepo.findOne({ where: { publicKey: data.publicKey } });
                if (!host) {
                    host = this.hostRepo.create({
                        publicKey: data.publicKey,
                        firstSeen: data.firstSeen ? new Date(data.firstSeen) : now,
                        lastSeen: data.lastScan ? new Date(data.lastScan) : new Date(0)
                    });
                } else {
                    host.lastSeen = data.lastScan ? new Date(data.lastScan) : host.lastSeen;
                }

                // CRITICAL: Ensure netAddress is not null for frontend search
                // Derive netAddress (V1 or V2)
                let netAddress = data.netAddress;
                if (!netAddress && data.v2NetAddresses && data.v2NetAddresses.length > 0) {
                    netAddress = data.v2NetAddresses[0].address;
                }
                host.netAddress = netAddress || '';

                host.settings = data.settings || {};
                host.v2Settings = data.v2Settings || {}; // Save v2 settings

                // REGION: Derive Country Code from IP (geoip-lite)
                let countryCode = data.countryCode || 'XX';

                // If country is missing or placeholder, try to resolve from IP
                if ((!countryCode || countryCode === 'XX' || countryCode === '') && host.netAddress) {
                    try {
                        // Extract IP from "ip:port" or "[ipv6]:port"
                        // Regex handles IPv4 (x.x.x.x) and IPv6 ([...]) ignoring port
                        const ipMatch = host.netAddress.match(/^\[?([^\]]+)\]?/);
                        const cleanParams = ipMatch ? ipMatch[1].split(':')[0] : host.netAddress.split(':')[0];

                        // Check if it's a valid IP (simple check not perfect but geoip handles it)
                        const geo = geoip.lookup(cleanParams);
                        if (geo && geo.country) {
                            countryCode = geo.country;
                        }
                    } catch (e) {
                        // Ignore lookup errors, keep default
                    }
                }
                host.countryCode = countryCode;

                // 2. Derive Metrics & Calculate Score
                const totalUptime = this.parseNumeric(data.uptimeTotal, 0);
                const totalTime = this.parseNumeric(data.uptimeH, 1) || 1; // Prevent div by 0
                const normUptime = Math.min(totalUptime / totalTime, 1);

                // Price: Parsing Logic - PRIORITIZE V2 (RHP3) over legacy V1
                // V1 hosts are no longer active on the network, so we focus on V2
                let rawStoragePrice = data.v2Settings?.prices?.storagePrice || // V2 nested price (preferred)
                    data.v2Settings?.storagePrice ||          // V2 shallow (fallback)
                    data.v2Settings?.prices?.storage_price || // V2 snake_case
                    data.settings?.storageprice ||            // V1 (legacy)
                    data.settings?.storagePrice;              // V1 camelCase

                const storagePrice = this.parseNumeric(rawStoragePrice, NaN); // Use NaN to detect missing

                // EXPLICIT V2 VERIFICATION: Only accept hosts running V2 protocol (RHP3)
                // V1 hosts are deprecated and no longer active on the network
                const isV2Host = data.v2 === true || !!data.v2Settings;

                // Note: We accept hosts regardless of acceptingContracts status
                // because hosts may temporarily disable this while reconfiguring.
                // This matches HostScore's approach and provides better coverage.
                if (!isV2Host) {
                    continue; // Skip V1-only hosts
                }

                const hasValidPrice = !isNaN(storagePrice) && storagePrice > 0;

                // Check if host was scanned recently (last 48 hours for better accuracy)
                // AND if the last scan was successful (host is actually online)
                const recentlyActive = (() => {
                    if (!data.lastScan) return false;
                    const scanDate = new Date(data.lastScan);
                    const hoursSinceLastScan = (now.getTime() - scanDate.getTime()) / (60 * 60 * 1000);
                    return hoursSinceLastScan <= 48; // Active in last 48 hours
                })();

                // CRITICAL: Check if last scan was successful (host is online)
                // This prevents accepting hosts that are offline/unreachable
                const isLastScanSuccessful = data.lastScanSuccessful === true;

                // STRICTEST filter: Require V2 protocol AND recent activity AND online status
                // This ensures we only show hosts that are:
                // 1. V2 protocol (RHP3)
                // 2. Scanned in last 48h
                // 3. Last scan was successful (online/reachable)
                // Note: We don't filter on acceptingContracts to match HostScore coverage
                if (!recentlyActive || !isLastScanSuccessful) {
                    // Skip hosts that haven't been seen recently OR are offline
                    continue;
                }

                // Optional: Among active contract-accepting hosts, prefer those with valid pricing
                // (but we accept them even without pricing if they're verified active)


                // Price normalization: if invalid price, use 0 (penalty)
                const normPrice = hasValidPrice ? Math.max(0, Math.min(1, 1000 / (storagePrice + 1))) : 0;

                const firstSeenDate = host.firstSeen || now;
                const ageMs = now.getTime() - firstSeenDate.getTime();
                const normAge = Math.min(ageMs / (365 * 24 * 3600 * 1000), 1);

                // Score Formula
                host.score = (normUptime * this.W_UPTIME) + (normPrice * this.W_PRICE) + (normAge * this.W_AGE);
                host.scoreUpdatedAt = now;

                // Save uptime metrics directly on Host entity for easier access
                host.totalUptime = totalUptime.toString();
                host.uptimeHours = totalTime.toString();

                await this.hostRepo.save(host);

                // 3. Insert Metric Snapshot (Partitioned)
                // Filter: Only insert metrics for hosts seen in the last 24 hours.
                const isOnline = (now.getTime() - host.lastSeen.getTime()) < 24 * 60 * 60 * 1000;

                if (isOnline) {
                    // Prioritize V2 settings for storage metrics
                    let remainingStorage = data.v2Settings?.remainingStorage ||
                        data.v2Settings?.remaining_storage ||
                        data.settings?.remainingstorage;

                    // Prioritize V2 settings for bandwidth prices
                    let uploadPrice = data.v2Settings?.prices?.ingressPrice ||
                        data.v2Settings?.prices?.ingress_price ||
                        data.settings?.uploadbandwidthprice ||
                        data.settings?.uploadprice;

                    let downloadPrice = data.v2Settings?.prices?.egressPrice ||
                        data.v2Settings?.prices?.egress_price ||
                        data.settings?.downloadbandwidthprice ||
                        data.settings?.downloadprice;

                    const metric = this.metricRepo.create({
                        time: now,
                        hostPublicKey: host.publicKey,
                        storagePrice: storagePrice,
                        uploadPrice: this.parseNumeric(uploadPrice, 0),
                        downloadPrice: this.parseNumeric(downloadPrice, 0),
                        remainingStorage: remainingStorage?.toString() || '0',
                        uptimeTotal: totalUptime.toString(),
                        uptimeH: totalTime.toString()
                    });
                    await this.metricRepo.save(metric);
                }
                successCount++;
            }

            offset += limit;

            // Safety break just in case of infinite loop
            if (offset > 100000) {
                this.logger.warn('Max host limit reached, stopping sync.');
                break;
            }
        }

        // CRITICAL: Auto-cleanup stale hosts after scan completes
        // Soft-delete hosts that weren't updated in this scan cycle (scoreUpdatedAt < scanStartTime)
        // This ensures the count stays accurate after each scan
        const staleHostsResult = await this.hostRepo
            .createQueryBuilder()
            .update()
            .set({ score: null, scoreUpdatedAt: null })
            .where('score IS NOT NULL')
            .andWhere('"scoreUpdatedAt" < :scanStartTime', { scanStartTime: now })
            .execute();

        if (staleHostsResult.affected > 0) {
            this.logger.log(`Cleaned up ${staleHostsResult.affected} stale hosts (not seen this scan).`);
        }

        this.logger.log(`Synced ${successCount}/${totalFetched} hosts.`);

        // Recursive Scheduling: Trigger next scan 30 minutes AFTER this one finishes
        this.logger.log('Scheduling next host scan in 30 minutes...');
        await this.ingestionQueue.add(
            'host-sync',
            {},
            {
                delay: 30 * 60 * 1000,
                removeOnComplete: true,
                removeOnFail: 100
            }
        );
    }
}
