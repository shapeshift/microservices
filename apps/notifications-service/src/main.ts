import { NestFactory } from '@nestjs/core'
import type { Response } from 'express'

import { allowedOrigins } from '@shapeshift/shared-utils'

import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: allowedOrigins(), allowedHeaders: ['Content-Type', 'Authorization'] })

  app.getHttpAdapter().get('/health', (_, res: Response) => {
    res.status(200).json({ status: 'ok' })
  })

  app.enableShutdownHooks()

  const port = process.env.NOTIFICATIONS_SERVICE_PORT || process.env.PORT || 3003
  await app.listen(port)

  console.log(`Notifications service is running on: http://localhost:${port}`)
}

void bootstrap()
