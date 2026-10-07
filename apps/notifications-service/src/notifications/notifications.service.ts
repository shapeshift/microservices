import { EventEmitter } from 'node:events'
import { HttpService } from '@nestjs/axios'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Notification } from '@prisma/client'
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'

import { CreateNotificationDto, Device, PushNotificationData } from '@shapeshift/shared-types'
import { getRequiredEnvVar } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class NotificationsService {
  readonly events = new EventEmitter()
  private readonly logger = new Logger(NotificationsService.name)
  private expo: Expo

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
  ) {
    this.expo = new Expo({
      accessToken: getRequiredEnvVar('EXPO_ACCESS_TOKEN'),
    })
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
      })

      this.events.emit('notification', notification)

      // Send push notification to all user devices
      await this.sendPushNotification(notification)

      return notification
    } catch {
      this.logger.error('Failed to create notification')
      throw new BadRequestException('Failed to create notification')
    }
  }

  async sendPushNotification(notification: Notification) {
    try {
      // Get user devices from user service
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL')
      const response = await this.httpService.axiosRef.get<Device[]>(
        `${userServiceUrl}/users/${notification.userId}/devices`,
      )
      const devices = response.data
      const activeDevices = devices.filter((device) => device.isActive)

      if (activeDevices.length === 0) {
        return []
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
        }))

      const tickets = await this.sendExpoPushNotifications(messages, notification.id)
      return tickets
    } catch {
      this.logger.error('Failed to send push notification')
      throw new BadRequestException('Failed to send push notification')
    }
  }

  async sendPushNotificationToDevice(
    deviceToken: string,
    title: string,
    body: string,
    data?: PushNotificationData,
  ): Promise<ExpoPushTicket[]> {
    try {
      if (!Expo.isExpoPushToken(deviceToken)) {
        throw new BadRequestException('Invalid Expo push token')
      }

      const message: ExpoPushMessage = {
        to: deviceToken,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority: 'high',
        channelId: 'swap-notifications',
      }

      const tickets = await this.sendExpoPushNotifications([message])
      return tickets
    } catch {
      this.logger.error('Failed to send push notification to device')
      throw new BadRequestException('Failed to send push notification to device')
    }
  }

  async sendPushNotificationToUser(
    userId: string,
    title: string,
    body: string,
    data?: PushNotificationData,
  ): Promise<ExpoPushTicket[]> {
    try {
      // Get user devices from user service
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL')
      const response = await this.httpService.axiosRef.get<Device[]>(`${userServiceUrl}/users/${userId}/devices`)
      const devices = response.data
      const activeDevices = devices.filter((device) => device.isActive)

      if (activeDevices.length === 0) {
        throw new BadRequestException(`No active devices found for user ${userId}`)
      }

      const messages: ExpoPushMessage[] = activeDevices.map((device) => ({
        to: device.deviceToken,
        sound: 'default',
        title,
        body,
        data: data || {},
        priority: 'high',
        channelId: 'swap-notifications',
      }))

      const tickets = await this.sendExpoPushNotifications(messages)
      return tickets
    } catch {
      throw new BadRequestException('Failed to send push notification to user')
    }
  }

  private async sendExpoPushNotifications(
    messages: ExpoPushMessage[],
    notificationId?: string,
  ): Promise<ExpoPushTicket[]> {
    const chunks = this.expo.chunkPushNotifications(messages)
    const tickets: ExpoPushTicket[] = []

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk)
        tickets.push(...ticketChunk)
      } catch {
        this.logger.error('Error sending chunk')
      }
    }

    // Update notification with delivery timestamp if notificationId is provided
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { deliveredAt: new Date() },
      })
    }

    this.logger.log(`Sent ${tickets.length} push notifications`)

    return tickets
  }

  async sendDeviceVerification(data: { deviceToken: string; registrationId: string; nonce: string }) {
    if (!Expo.isExpoPushToken(data.deviceToken)) throw new BadRequestException('Invalid push token')
    const tickets = await this.expo.sendPushNotificationsAsync([
      {
        to: data.deviceToken,
        _contentAvailable: true,
        ttl: 300,
        data: { type: 'DEVICE_VERIFICATION', registrationId: data.registrationId, nonce: data.nonce },
      },
    ])
    if (tickets.some((ticket) => ticket.status === 'error'))
      throw new BadRequestException('Could not deliver device verification')
    return { success: true }
  }

  async registerDevice(userId: string, deviceToken: string, deviceType: 'MOBILE' | 'WEB') {
    try {
      // Only validate Expo push token for mobile devices
      if (deviceType === 'MOBILE' && !Expo.isExpoPushToken(deviceToken)) {
        throw new BadRequestException('Invalid Expo push token')
      }

      // For web devices, we expect a websocket channel identifier
      if (deviceType === 'WEB' && !deviceToken) {
        throw new BadRequestException('Invalid websocket channel identifier')
      }

      // Register device with user service
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL')
      const response = await this.httpService.axiosRef.post<Device>(`${userServiceUrl}/users/${userId}/devices`, {
        deviceToken,
        deviceType,
      })
      const device = response.data

      return device
    } catch {
      this.logger.error('Failed to register device')
      throw new BadRequestException('Failed to register device')
    }
  }

  async getUserNotifications(userId: string, limit = 50): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: limit,
    })
  }

  async getUserDevices(userId: string): Promise<Device[]> {
    try {
      const userServiceUrl = getRequiredEnvVar('USER_SERVICE_URL')
      const response = await this.httpService.axiosRef.get<Device[]>(`${userServiceUrl}/users/${userId}/devices`)
      return response.data
    } catch {
      this.logger.error('Failed to get user devices')
      throw new BadRequestException('Failed to get user devices')
    }
  }
}
