import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'

import { DeviceSessions, SecurityRateLimiter, ServiceOrDeviceGuard } from '@shapeshift/shared-utils'

import { NotificationsController } from './notifications/notifications.controller'
import { NotificationsService } from './notifications/notifications.service'
import { PrismaService } from './prisma/prisma.service'
import { WebsocketGateway } from './websocket/websocket.gateway'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    HttpModule.registerAsync({
      useFactory: () => ({
        headers: { 'x-api-key': process.env.SERVICE_API_KEY },
        timeout: 10000,
        maxRedirects: 0,
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    { provide: APP_GUARD, useClass: ServiceOrDeviceGuard },
    NotificationsService,
    WebsocketGateway,
    PrismaService,
    DeviceSessions,
    SecurityRateLimiter,
    { provide: 'SECURITY_DB', useExisting: PrismaService },
  ],
})
export class AppModule {}
