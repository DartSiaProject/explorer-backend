import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import axios from 'axios';

@Controller('v1')
export class ProxyController {
    @All('explorer*')
    async proxyToExplorer(@Req() req: Request, @Res() res: Response) {
        const targetUrl = process.env.EXPLORER_URL || 'http://explorer:3001';
        // Incoming: /api/v1/explorer/blocks/tip (has global /api prefix)
        // Need to transform to: /api/v1/blocks/tip (for Explorer service)
        // So we remove '/api/v1/explorer' and replace with '/api/v1'
        const path = req.url.replace('/api/v1/explorer', '/api/v1');

        console.log(`[Gateway Proxy] Explorer: ${req.method} ${req.url} -> ${targetUrl}${path}`);

        try {
            const response = await axios({
                method: req.method,
                url: `${targetUrl}${path}`,
                data: req.body,
                headers: {
                    ...req.headers,
                    host: undefined,
                },
                validateStatus: () => true,
            });

            res.status(response.status).send(response.data);
        } catch (error) {
            console.error('[Gateway Proxy] Explorer error:', error.message);
            res.status(500).send({ error: 'Gateway proxy error', message: error.message });
        }
    }

    @All('analytics*')
    async proxyToAnalytics(@Req() req: Request, @Res() res: Response) {
        const targetUrl = process.env.ANALYTICS_URL || 'http://analytics:3002';
        // Analytics controller uses @Controller('analytics'), so we need /api/analytics/...
        // Incoming: /api/v1/analytics/network -> Transform to: /api/analytics/network
        const path = req.url.replace('/api/v1', '/api');

        console.log(`[Gateway Proxy] Analytics: ${req.method} ${req.url} -> ${targetUrl}${path}`);

        try {
            const response = await axios({
                method: req.method,
                url: `${targetUrl}${path}`,
                data: req.body,
                headers: {
                    ...req.headers,
                    host: undefined,
                },
                validateStatus: () => true,
            });

            res.status(response.status).send(response.data);
        } catch (error) {
            console.error('[Gateway Proxy] Analytics error:', error.message);
            res.status(500).send({ error: 'Gateway proxy error', message: error.message });
        }
    }
}
