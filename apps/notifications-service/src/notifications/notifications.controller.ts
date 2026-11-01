import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common'
import { z } from 'zod'

import { NotificationType, PushNotificationData } from '@shapeshift/shared-types'
import type { UserRequest } from '@shapeshift/shared-utils'
import { DeviceAccess, SecurityRateLimiter } from '@shapeshift/shared-utils'

import { NotificationsService } from './notifications.service'

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly limits: SecurityRateLimiter,
  ) {}

  @Post()
  async createNotification(
    @Body()
    data: {
      userId: string
      title: string
      body: string
      type: NotificationType
      swapId?: string
    },
  ) {
    return this.notificationsService.createNotification(data)
  }

  @Post('register-device')
  async registerDevice(
    @Body()
    data: {
      userId: string
      deviceToken: string
      deviceType: 'MOBILE' | 'WEB'
    },
  ) {
    return this.notificationsService.registerDevice(data.userId, data.deviceToken, data.deviceType)
  }

  @Header('Cache-Control', 'no-store')
  @Get('me')
  @DeviceAccess()
  async mine(@Req() request: UserRequest, @Query('limit') limit?: string) {
    if (limit !== undefined && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit))
      throw new BadRequestException('Limit must be between 1 and 100')
    await this.limits.consume('notification-read', request.userId, 60)
    return this.notificationsService.getUserNotifications(request.userId, limit ? Number(limit) : 50)
  }

  @Get('user/:userId')
  async getUserNotifications(@Param('userId') userId: string, @Query('limit') limit?: string) {
    return this.notificationsService.getUserNotifications(userId, limit ? parseInt(limit) : 50)
  }

  @Get('devices/:userId')
  async getUserDevices(@Param('userId') userId: string) {
    return this.notificationsService.getUserDevices(userId)
  }

  @Post('send-to-user')
  async sendToUser(
    @Body()
    data: {
      userId: string
      title: string
      body: string
      data?: PushNotificationData
    },
  ) {
    return this.notificationsService.sendPushNotificationToUser(data.userId, data.title, data.body, data.data)
  }

  @Post('verify-device')
  async verifyDevice(@Body() input: unknown) {
    const parsed = z
      .strictObject({
        deviceToken: z.string().max(256),
        registrationId: z.uuid(),
        nonce: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid verification request')
    return this.notificationsService.sendDeviceVerification(parsed.data)
  }

  @Post('send-to-device')
  async sendToDevice(
    @Body()
    data: {
      deviceToken: string
      title: string
      body: string
      data?: PushNotificationData
    },
  ) {
    return this.notificationsService.sendPushNotificationToDevice(data.deviceToken, data.title, data.body, data.data)
  }
}
