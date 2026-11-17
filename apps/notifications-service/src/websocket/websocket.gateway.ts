import { createHash, timingSafeEqual } from 'node:crypto'
import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

import { API_KEY_HEADER } from '@shapeshift/shared-utils'

import { NotificationsService } from '../notifications/notifications.service'

const digest = (value: string) => createHash('sha256').update(value).digest()

/** No app uses this socket; until one needs it, only callers holding the service key may connect. */
export function hasServiceKey(supplied: unknown, expected = process.env.SERVICE_API_KEY): boolean {
  return Boolean(expected) && typeof supplied === 'string' && timingSafeEqual(digest(supplied), digest(expected))
}

interface AuthenticatedSocket extends Socket {
  userId?: string
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class WebsocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(WebsocketGateway.name)
  private connectedClients = new Map<string, AuthenticatedSocket>()

  constructor(private notificationsService: NotificationsService) {}

  afterInit(server: Server) {
    // Rejects the handshake itself, so unauthenticated clients never reach a handler.
    server.use((socket, next) =>
      hasServiceKey(socket.handshake.headers[API_KEY_HEADER]) ? next() : next(new Error('Service credential required')),
    )
  }

  handleConnection(client: AuthenticatedSocket) {
    this.logger.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`)
    if (client.userId) {
      this.connectedClients.delete(client.userId)
    }
  }

  @SubscribeMessage('getNotifications')
  async handleGetNotifications(
    @MessageBody() data: { limit?: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      return { error: 'Not authenticated' }
    }

    try {
      const notifications = await this.notificationsService.getUserNotifications(client.userId, data.limit || 50)
      return { success: true, notifications }
    } catch (error) {
      this.logger.error('Failed to get notifications', error)
      return { error: 'Failed to get notifications' }
    }
  }

  sendNotificationToUser(
    userId: string,
    notification: {
      id: string
      title: string
      body: string
      type: string
      swapId?: string
    },
  ) {
    const client = this.connectedClients.get(userId)
    if (client) {
      client.emit('notification', notification)
    }

    this.server.to(`user:${userId}`).emit('notification', notification)
  }

  broadcastToAll(event: string, data: Record<string, unknown>) {
    this.server.emit(event, data)
  }
}
