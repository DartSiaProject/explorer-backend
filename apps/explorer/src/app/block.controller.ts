import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { BlockService } from './block.service';

@Controller('blocks')
export class BlockController {
    constructor(private readonly blockService: BlockService) { }

    @Get('tip')
    getTip() {
        return this.blockService.getTip();
    }

    @Get()
    getBlocks(
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '20',
    ) {
        return this.blockService.getBlocks(
            parseInt(page),
            parseInt(limit)
        );
    }

    @Get('search')
    async searchBlock(@Query('q') query: string) {
        const result = await this.blockService.searchBlock(query);
        return result ? [result] : [];
    }

    @Get('stats')
    async getStats() {
        return this.blockService.getBlockStats();
    }

    @Get(':id')
    getBlock(@Param('id') id: string) {
        return this.blockService.getBlock(id);
    }
}
