import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('network')
    getNetworkStats() {
        return this.analyticsService.getNetworkStats();
    }

    @Get('network/history')
    getNetworkHistory(@Query('period') period: '24h' | '30d') {
        return this.analyticsService.getNetworkHistory(period);
    }

    @Get('hosts/top')
    getTopHosts(@Query('limit') limit: number) {
        return this.analyticsService.getTopHosts(limit || 50);
    }

    @Get('hosts/:pubkey/history')
    getHostHistory(@Param('pubkey') pubkey: string) {
        return this.analyticsService.getHostHistory(pubkey);
    }
}
