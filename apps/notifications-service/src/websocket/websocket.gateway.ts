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
