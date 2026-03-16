import { Controller, Get, Param, Query } from '@nestjs/common';
import { TransactionService } from './transaction.service';

@Controller('tx')
export class TransactionController {
    constructor(private readonly transactionService: TransactionService) { }

    @Get('recent')
    getRecent(@Query('limit') limit?: any) {
        const take = limit ? parseInt(limit) : 50;
        return this.transactionService.getRecentTransactions(take);
    }

    @Get(':id')
    getTransaction(@Param('id') id: string) {
        return this.transactionService.getTransaction(id);
    }
}
