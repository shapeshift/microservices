import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { AppModule } from './app.module';
import { ChainAdapterInitService } from './lib/chain-adapter-init.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Initialize chain adapters
  const chainAdapterInitService = app.get(ChainAdapterInitService);
  await chainAdapterInitService.initializeChainAdapters();

  // Enable CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      /\.shapeshift\.com$/,
    ],
    credentials: true,
  });

  app.getHttpAdapter().get('/health', (_, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`Swap service is running on: http://localhost:${port}`);
}

bootstrap();
