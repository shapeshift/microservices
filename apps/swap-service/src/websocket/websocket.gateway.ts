import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

import type { SwapWithAssets } from '../swaps/swaps.service'
import { SwapsService } from '../swaps/swaps.service'

interface AuthenticatedSocket extends Socket {
  userId?: string
}

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [/^http:\/\/(\w+\.)?localhost(:\d+)?$/, /\.shapeshift\.com$/],
    credentials: true,
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(WebsocketGateway.name)
  private connectedClients = new Map<string, AuthenticatedSocket>()

  constructor(private swapsService: SwapsService) {}

  handleConnection(client: AuthenticatedSocket) {
    this.logger.log(`Client connected: ${client.id}`)
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`)
    if (client.userId) this.connectedClients.delete(client.userId)
  }

  @SubscribeMessage('getSwaps')
  async handleGetSwaps(
    @MessageBody() data: { limit?: number; cursor?: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) return { error: 'Not authenticated' }

    try {
      const { items, nextCursor } = await this.swapsService.getSwapsByUser(client.userId, {
        limit: data.limit || 50,
        cursor: data.cursor,
      })

      return { success: true, swaps: items, nextCursor }
    } catch (error) {
      this.logger.error('Failed to get swaps', error)
      return { error: 'Failed to get swaps' }
    }
  }

  sendSwapUpdateToUser(userId: string, swap: SwapWithAssets) {
    const client = this.connectedClients.get(userId)
    if (client) client.emit('swapUpdate', swap)
    this.server.to(`user:${userId}`).emit('swapUpdate', swap)
  }
}
