import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction) {
        const apiKey = req.headers['x-api-key'];
        const validKey = process.env.API_KEY_SECRET;

        // Only enforce if secret is set in env
        if (validKey && apiKey !== validKey) {
            throw new UnauthorizedException('Invalid or missing API Key');
        }
        next();
    }
}
