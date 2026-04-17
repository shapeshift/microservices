import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

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
    HttpModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, WebsocketGateway, PrismaService],
})
export class AppModule {}
