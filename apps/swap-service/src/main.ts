import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ChainAdapterInitService } from './lib/chain-adapter-init.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Initialize chain adapters
  const chainAdapterInitService = app.get(ChainAdapterInitService);
  await chainAdapterInitService.initializeChainAdapters();
  
  // Enable CORS
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Swap service is running on: http://localhost:${port}`);
}

bootstrap();
