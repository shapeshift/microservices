import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { API_KEY_HEADER, getRequiredEnvVar } from '@shapeshift/shared-utils'

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
        headers: { [API_KEY_HEADER]: getRequiredEnvVar('SERVICE_API_KEY') },
        timeout: 10_000,
        maxRedirects: 0,
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, WebsocketGateway, PrismaService],
})
export class AppModule {}
