import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ChainAdapterInitService } from './lib/chain-adapter-init.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Initialize chain adapters
  const chainAdapterInitService = app.get(ChainAdapterInitService);
  await chainAdapterInitService.initializeChainAdapters();
  
  await app.listen(3001);
  console.log('Swap service is running on port 3001');
}

bootstrap();
