import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { Notification } from '@prisma/client'
import type { DefaultEventsMap } from 'socket.io'
import { Server, Socket } from 'socket.io'

import { allowedOrigins, clientIp, DeviceSessions, SecurityRateLimiter } from '@shapeshift/shared-utils'

import { NotificationsService } from '../notifications/notifications.service'

type DeviceSocketData = { token?: string; userId?: string; expiryTimer?: NodeJS.Timeout; checkTimer?: NodeJS.Timeout }
type AuthenticatedSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, DeviceSocketData>

@WebSocketGateway({
  maxHttpBufferSize: 8192,
  cors: { origin: (origin, callback) => callback(null, Boolean(origin && allowedOrigins().includes(origin))) },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, DeviceSocketData>
  private readonly logger = new Logger(WebsocketGateway.name)
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly sessions: DeviceSessions,
    private readonly limits: SecurityRateLimiter,
  ) {}

  private readonly onNotification = (notification: Notification) => {
    void this.sendNotificationToUser(notification.userId, notification).catch(() =>
      this.logger.error('WebSocket delivery failed'),
    )
  }

  onModuleInit() {
    this.notificationsService.events.on('notification', this.onNotification)
  }
  onModuleDestroy() {
    this.notificationsService.events.off('notification', this.onNotification)
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      await this.limits.consume(
        'notification-connect',
        clientIp(client.handshake.address, client.handshake.headers['x-forwarded-for'] as string | undefined),
        30,
      )
      const token: unknown = client.handshake.auth?.token
      const session = await this.sessions.authenticate(token)
      if (!client.connected) return
      client.data.token = token as string
      client.data.userId = session.userId
      await client.join(`user:${session.userId}`)
      client.data.expiryTimer = setTimeout(
        () => client.disconnect(true),
        Math.max(0, session.expiresAt.getTime() - Date.now()),
      )
      client.data.checkTimer = setInterval(() => {
        void this.sessions.authenticate(client.data.token).catch(() => client.disconnect(true))
      }, 30_000)
    } catch {
      client.disconnect(true)
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    clearTimeout(client.data.expiryTimer)
    clearInterval(client.data.checkTimer)
    client.data.token = undefined
  }

  @SubscribeMessage('getNotifications')
  async handleGetNotifications(
    @MessageBody() data: { limit?: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const session = await this.sessions.authenticate(client.data.token)
      await this.limits.consume('notification-read', session.userId, 60)
      const limit = data?.limit ?? 50
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { error: 'Invalid limit' }
      return {
        success: true,
        notifications: await this.notificationsService.getUserNotifications(session.userId, limit),
      }
    } catch {
      client.disconnect(true)
      return { error: 'Sign in required' }
    }
  }

  async sendNotificationToUser(
    userId: string,
    notification: Pick<Notification, 'id' | 'title' | 'body' | 'type' | 'swapId'>,
  ) {
    const sockets = await this.server.in(`user:${userId}`).fetchSockets()
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          const session = await this.sessions.authenticate(socket.data.token)
          if (session.userId !== userId) {
            socket.disconnect(true)
            return
          }
          socket.emit('notification', notification)
        } catch {
          socket.disconnect(true)
        }
      }),
    )
  }
}
