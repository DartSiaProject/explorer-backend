import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  Logger.log(`🚀 Worker application is running`);

  // Note: BullMQ workers run automatically when module is initialized.
}

bootstrap();
