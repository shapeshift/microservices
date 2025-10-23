import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { SwapsService } from '../swaps/swaps.service';
import { Asset } from '@shapeshiftoss/types';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingTimeout: 10000,
  pingInterval: 25000,
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private connectedClients = new Map<string, AuthenticatedSocket>();

  constructor(private swapsService: SwapsService) {}

  handleConnection(client: AuthenticatedSocket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    if (client.userId) {
      this.connectedClients.delete(client.userId);
    }
  }

  @SubscribeMessage('authenticate')
  handleAuthenticate(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!data.userId) {
      this.logger.warn(`Authentication failed: No userId provided`);
      return { success: false, error: 'userId is required' };
    }

    client.userId = data.userId;
    this.connectedClients.set(data.userId, client);

    // Join a user-specific room for targeted swap updates
    client.join(`user:${data.userId}`);

    this.logger.log(`Client authenticated: ${client.id} as user ${data.userId}`);
    return { success: true };
  }

  @SubscribeMessage('getSwaps')
  async handleGetSwaps(
    @MessageBody() data: { limit?: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      return { error: 'Not authenticated' };
    }

    try {
      const swaps = await this.swapsService.getSwapsByUser(
        client.userId,
        data.limit || 50,
      );
      return { success: true, swaps };
    } catch (error) {
      this.logger.error('Failed to get swaps', error);
      return { error: 'Failed to get swaps' };
    }
  }

  async sendSwapUpdateToUser(userId: string, swap: { 
    id: string; 
    swapId: string; 
    status: string; 
    sellAsset: Asset; 
    buyAsset: Asset; 
    sellAmountCryptoBaseUnit: string; 
    expectedBuyAmountCryptoBaseUnit: string; 
    sellAccountId: string; 
    buyAccountId?: string; 
    sellTxHash?: string; 
    buyTxHash?: string; 
    statusMessage?: string; 
  }) {
    const client = this.connectedClients.get(userId);
    if (client) {
      client.emit('swapUpdate', swap);
    }
    
    this.server.to(`user:${userId}`).emit('swapUpdate', swap);
  }

  broadcastToAll(event: string, data: Record<string, unknown>) {
    this.server.emit(event, data);
  }
}
