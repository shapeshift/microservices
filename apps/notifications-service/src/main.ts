import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  console.log(`Notifications service is running on: http://localhost:${port}`);
}

bootstrap();
