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
import { NotificationsService } from '../notifications/notifications.service';

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

  constructor(private notificationsService: NotificationsService) {}

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

    // Join a user-specific room for targeted notifications
    client.join(`user:${data.userId}`);

    this.logger.log(`Client authenticated: ${client.id} as user ${data.userId}`);
    return { success: true };
  }

  @SubscribeMessage('getNotifications')
  async handleGetNotifications(
    @MessageBody() data: { limit?: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.userId) {
      return { error: 'Not authenticated' };
    }

    try {
      const notifications = await this.notificationsService.getUserNotifications(
        client.userId,
        data.limit || 50,
      );
      return { success: true, notifications };
    } catch (error) {
      this.logger.error('Failed to get notifications', error);
      return { error: 'Failed to get notifications' };
    }
  }

  async sendNotificationToUser(userId: string, notification: { 
    id: string; 
    title: string; 
    body: string; 
    type: string; 
    swapId?: string; 
  }) {
    const client = this.connectedClients.get(userId);
    if (client) {
      client.emit('notification', notification);
    }
    
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  broadcastToAll(event: string, data: Record<string, unknown>) {
    this.server.emit(event, data);
  }
}
