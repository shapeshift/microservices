import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Response } from 'express'

import { AppModule } from './app.module'
import { env } from './env'
import { ChainAdapterInitService } from './lib/chain-adapter-init.service'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))

  // Initialize chain adapters
  const chainAdapterInitService = app.get(ChainAdapterInitService)
  chainAdapterInitService.initializeChainAdapters()

  // Enable CORS
  app.enableCors({
    origin: env.ALLOWED_ORIGINS?.split(',') || [/^http:\/\/(\w+\.)?localhost(:\d+)?$/, /\.shapeshift\.com$/],
    credentials: true,
  })

  app.getHttpAdapter().get('/health', (_, res: Response) => {
    res.status(200).json({ status: 'ok' })
  })

  app.enableShutdownHooks()

  const port = env.PORT || 3001
  await app.listen(port)

  console.log(`Swap service is running on: http://localhost:${port}`)
}

void bootstrap()
