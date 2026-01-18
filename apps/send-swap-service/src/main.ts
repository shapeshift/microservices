import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { AppModule } from './app.module';
import { WalletInitService } from './wallet/wallet-init.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Initialize wallets before starting HTTP listener
  const walletInitService = app.get(WalletInitService);
  await walletInitService.initializeWallets();

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

  const port = process.env.PORT || 3004;
  await app.listen(port);

  console.log(`Send-swap service is running on: http://localhost:${port}`);
}

bootstrap();
