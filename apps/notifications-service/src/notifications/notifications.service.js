"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("@nestjs/axios");
const expo_server_sdk_1 = require("expo-server-sdk");
const prisma_service_1 = require("../prisma/prisma.service");
const shared_utils_1 = require("@shapeshift/shared-utils");
let NotificationsService = NotificationsService_1 = class NotificationsService {
    constructor(prisma, httpService) {
        this.prisma = prisma;
        this.httpService = httpService;
        this.logger = new common_1.Logger(NotificationsService_1.name);
        this.expo = new expo_server_sdk_1.Expo({
            accessToken: (0, shared_utils_1.getRequiredEnvVar)('EXPO_ACCESS_TOKEN'),
        });
    }
    async createNotification(data) {
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
        }
        catch (error) {
            this.logger.error('Failed to create notification', error);
            throw error;
        }
    }
    async sendPushNotification(notification) {
        try {
            // Get user devices from user service
            const userServiceUrl = (0, shared_utils_1.getRequiredEnvVar)('USER_SERVICE_URL');
            const response = await this.httpService.axiosRef.get(`${userServiceUrl}/users/${notification.userId}/devices`);
            const devices = response.data;
            const activeDevices = devices.filter((device) => device.isActive);
            if (activeDevices.length === 0) {
                throw new common_1.BadRequestException(`No active devices found for user ${notification.userId}`);
            }
            const messages = activeDevices
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
        }
        catch (error) {
            this.logger.error('Failed to send push notification', error);
            throw new common_1.BadRequestException('Failed to send push notification');
        }
    }
    async sendPushNotificationToDevice(deviceToken, title, body, data) {
        try {
            if (!expo_server_sdk_1.Expo.isExpoPushToken(deviceToken)) {
                throw new common_1.BadRequestException(`Invalid Expo push token: ${String(deviceToken)}`);
            }
            const message = {
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
        }
        catch (error) {
            this.logger.error('Failed to send push notification to device', error);
            throw new common_1.BadRequestException('Failed to send push notification to device');
        }
    }
    async sendPushNotificationToUser(userId, title, body, data) {
        try {
            // Get user devices from user service
            const userServiceUrl = (0, shared_utils_1.getRequiredEnvVar)('USER_SERVICE_URL');
            const response = await this.httpService.axiosRef.get(`${userServiceUrl}/users/${userId}/devices`);
            const devices = response.data;
            const activeDevices = devices.filter((device) => device.isActive);
            if (activeDevices.length === 0) {
                throw new common_1.BadRequestException(`No active devices found for user ${userId}`);
            }
            const messages = activeDevices.map((device) => ({
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
        }
        catch {
            throw new common_1.BadRequestException('Failed to send push notification to user');
        }
    }
    async sendExpoPushNotifications(messages, notificationId) {
        const chunks = this.expo.chunkPushNotifications(messages);
        const tickets = [];
        for (const chunk of chunks) {
            try {
                const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            }
            catch (error) {
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
    async registerDevice(userId, deviceToken, deviceType) {
        try {
            this.logger.log(`registerDevice called with userId: ${userId}, deviceType: ${deviceType}, deviceToken: ${deviceToken}`);
            // Only validate Expo push token for mobile devices
            if (deviceType === 'MOBILE' && !expo_server_sdk_1.Expo.isExpoPushToken(deviceToken)) {
                throw new common_1.BadRequestException('Invalid Expo push token');
            }
            // For web devices, we expect a websocket channel identifier
            if (deviceType === 'WEB' && !deviceToken) {
                throw new common_1.BadRequestException('Invalid websocket channel identifier');
            }
            // Register device with user service
            const userServiceUrl = (0, shared_utils_1.getRequiredEnvVar)('USER_SERVICE_URL');
            const response = await this.httpService.axiosRef.post(`${userServiceUrl}/users/${userId}/devices`, {
                deviceToken,
                deviceType,
            });
            const device = response.data;
            this.logger.log(`Device registered: ${deviceToken} for user ${userId} (${deviceType})`);
            return device;
        }
        catch (error) {
            this.logger.error('Failed to register device', error);
            throw new common_1.BadRequestException('Failed to register device');
        }
    }
    async getUserNotifications(userId, limit = 50) {
        return this.prisma.notification.findMany({
            where: { userId },
            orderBy: { sentAt: 'desc' },
            take: limit,
        });
    }
    async getUserDevices(userId) {
        try {
            const userServiceUrl = (0, shared_utils_1.getRequiredEnvVar)('USER_SERVICE_URL');
            const response = await this.httpService.axiosRef.get(`${userServiceUrl}/users/${userId}/devices`);
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to get user devices', error);
            throw new common_1.BadRequestException('Failed to get user devices');
        }
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        axios_1.HttpService])
], NotificationsService);
