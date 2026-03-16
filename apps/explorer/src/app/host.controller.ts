import { Controller, Get } from '@nestjs/common';
import { HostService } from './host.service';

@Controller('hosts')
export class HostController {
    constructor(private readonly hostService: HostService) { }

    @Get()
    getHosts() {
        return this.hostService.getHosts();
    }
}
