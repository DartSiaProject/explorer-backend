import { Module, MiddlewareConsumer } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiKeyMiddleware } from './api-key.middleware';
import { ProxyController } from './proxy.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
  ],
  controllers: [ProxyController],
  providers: [],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply Auth to all routes
    consumer.apply(ApiKeyMiddleware).forRoutes('*');
  }
}
