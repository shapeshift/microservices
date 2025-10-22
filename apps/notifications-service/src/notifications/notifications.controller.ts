import { Controller, Post, Body, Get, Param, Query, Put } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '@shapeshift/shared-types';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  async createNotification(@Body() data: {
    userId: string;
    title: string;
    body: string;
    type: NotificationType;
    swapId?: string;
  }) {
    return this.notificationsService.createNotification(data);
  }

  @Post('register-device')
  async registerDevice(
    @Body() data: { userId: string; deviceToken: string; deviceType: 'MOBILE' | 'WEB' },
  ) {
    return this.notificationsService.registerDevice(
      data.userId,
      data.deviceToken,
      data.deviceType,
    );
  }

  @Get('user/:userId')
  async getUserNotifications(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.getUserNotifications(
      userId,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get('devices/:userId')
  async getUserDevices(@Param('userId') userId: string) {
    return this.notificationsService.getUserDevices(userId);
  }

  @Post('send-to-user')
  async sendToUser(@Body() data: {
    userId: string;
    title: string;
    body: string;
    data?: any;
  }) {
    return this.notificationsService.sendPushNotificationToUser(
      data.userId,
      data.title,
      data.body,
      data.data,
    );
  }

  @Post('send-to-device')
  async sendToDevice(@Body() data: {
    deviceToken: string;
    title: string;
    body: string;
    data?: any;
  }) {
    return this.notificationsService.sendPushNotificationToDevice(
      data.deviceToken,
      data.title,
      data.body,
      data.data,
    );
  }
}
