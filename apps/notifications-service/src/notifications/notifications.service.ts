import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { getRequiredEnvVar } from '@shapeshift/shared-utils';
import { 
  CreateNotificationDto,
  Device,
  PushNotificationData
} from '@shapeshift/shared-types';
import { Notification } from '@prisma/client';


@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private expo: Expo;

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService
  ) {
    this.expo = new Expo({ accessToken: getRequiredEnvVar('EXPO_ACCESS_TOKEN') });
  }

  async createNotification(data: CreateNotificationDto): Promise<Notification> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId: data.userId,
          title: data.title,
          body: data.body,
          type: data.type,
          swapId: data.swapId,
        },
      });

      // Send push notification to all user devices
      await this.sendPushNotification(notification);

      return notification;
    } catch (error) {
      this.logger.error('Failed to create notification', error);
      throw error;
    }
  }

  async sendPushNotification(notification: Notification) {
    try {
      // Get user devices from user service
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL');
      const response = await this.httpService.axiosRef.get<Device[]>(`${userServiceUrl}/users/${notification.userId}/devices`);
      const devices = response.data;
      const activeDevices = devices.filter((device) => device.isActive);
      
      if (activeDevices.length === 0) {
        throw new BadRequestException(`No active devices found for user ${notification.userId}`);
      }

      const messages: ExpoPushMessage[] = activeDevices
        .filter((device) => device.deviceType === 'MOBILE')
        .map((device) => ({
          to: device.deviceToken,
          sound: 'default',
          title: notification.title,
          body: notification.body,
          data: {
            notificationId: notification.id,
            type: notification.type,
            swapId: notification.swapId,
          },
          priority: 'high',
          channelId: 'swap-notifications',
        }));

      const tickets = await this.sendExpoPushNotifications(messages, notification.id);
      return tickets;
    } catch (error) {
      this.logger.error('Failed to send push notification', error);
      throw new BadRequestException('Failed to send push notification');
    }
  }

  async sendPushNotificationToDevice(
    deviceToken: string, 
    title: string, 
    body: string, 
    data?: PushNotificationData
  ): Promise<ExpoPushTicket[]> {
    try {
      if (!Expo.isExpoPushToken(deviceToken)) {
        throw new BadRequestException(`Invalid Expo push token: ${deviceToken}`);
      }

      const message: ExpoPushMessage = {
        to: deviceToken,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority: 'high',
        channelId: 'swap-notifications',
      };

      const tickets = await this.sendExpoPushNotifications([message]);
      return tickets;
    } catch (error) {
      this.logger.error('Failed to send push notification to device', error);
      throw new BadRequestException('Failed to send push notification to device');
    }
  }

  async sendPushNotificationToUser(
    userId: string, 
    title: string, 
    body: string, 
    data?: PushNotificationData
  ): Promise<ExpoPushTicket[]> {
    try {
      // Get user devices from user service
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL');
      const response = await this.httpService.axiosRef.get<Device[]>(`${userServiceUrl}/users/${userId}/devices`);
      const devices = response.data;
      const activeDevices = devices.filter((device) => device.isActive);

      if (activeDevices.length === 0) {
        throw new BadRequestException(`No active devices found for user ${userId}`);
      }

      const messages: ExpoPushMessage[] = activeDevices.map((device: any) => ({
        to: device.deviceToken,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority: 'high',
        channelId: 'swap-notifications',
      }));

      const tickets = await this.sendExpoPushNotifications(messages);
      return tickets;
    } catch (error) {
      throw new BadRequestException('Failed to send push notification to user');
    }
  }

  private async sendExpoPushNotifications(messages: ExpoPushMessage[], notificationId?: string): Promise<ExpoPushTicket[]> {
    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        this.logger.error('Error sending chunk', error);
      }
    }

    // Update notification with delivery timestamp if notificationId is provided
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { deliveredAt: new Date() },
      });
    }

    this.logger.log(`Sent ${tickets.length} push notifications`);

    return tickets;
  }

  async registerDevice(userId: string, deviceToken: string, deviceType: 'MOBILE' | 'WEB') {
    try {
      this.logger.log(`registerDevice called with userId: ${userId}, deviceType: ${deviceType}, deviceToken: ${deviceToken}`);
      
      // Only validate Expo push token for mobile devices
      if (deviceType === 'MOBILE' && !Expo.isExpoPushToken(deviceToken)) {
        throw new BadRequestException('Invalid Expo push token');
      }

      // For web devices, we expect a websocket channel identifier
      if (deviceType === 'WEB' && !deviceToken) {
        throw new BadRequestException('Invalid websocket channel identifier');
      }

      // Register device with user service
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL');
      const response = await this.httpService.axiosRef.post<Device>(`${userServiceUrl}/users/${userId}/devices`, {
        deviceToken,
        deviceType,
      });
      const device = response.data;
      this.logger.log(`Device registered: ${deviceToken} for user ${userId} (${deviceType})`);
      return device;
    } catch (error) {
      this.logger.error('Failed to register device', error);
      throw new BadRequestException('Failed to register device');
    }
  }

  async getUserNotifications(userId: string, limit = 50): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: limit,
    });
  }

  async getUserDevices(userId: string): Promise<Device[]> {
    try {
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL');
      const response = await this.httpService.axiosRef.get<Device[]>(`${userServiceUrl}/users/${userId}/devices`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get user devices', error);
      throw new BadRequestException('Failed to get user devices');
    }
  }
}
