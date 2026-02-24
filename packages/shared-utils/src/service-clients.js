"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapServiceClient = exports.NotificationsServiceClient = exports.UserServiceClient = void 0;
const axios_1 = __importDefault(require("axios"));
const index_1 = require("./index");
class UserServiceClient {
    constructor() {
        const baseUrl = (0, index_1.getRequiredEnvVar)('USER_SERVICE_URL');
        this.axios = axios_1.default.create({
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    async getUserById(userId) {
        const response = await this.axios.get(`/users/${userId}`);
        return response.data;
    }
    async getUserByAccountId(accountId) {
        const response = await this.axios.get(`/users/account/${accountId}`);
        return response.data;
    }
    async getOrCreateUserByAccountIds(accountIds) {
        const response = await this.axios.post('/users/get-or-create', {
            accountIds,
        });
        return response.data;
    }
    async getUserDevices(userId) {
        const response = await this.axios.get(`/users/${userId}/devices`);
        return response.data;
    }
    async getUserReferralCode(userId) {
        try {
            const user = await this.getUserById(userId);
            if (!user || !user.userAccounts || user.userAccounts.length === 0) {
                return null;
            }
            // Get the first account's hashed ID to check referral usage
            const hashedAccountId = user.userAccounts[0].accountId;
            const response = await this.axios.get(`/referrals/usage/${hashedAccountId}`);
            return response.data?.referralCode || null;
        }
        catch {
            // If no referral usage found, return null
            return null;
        }
    }
    async getReferralUsages(referralCode) {
        try {
            const response = await this.axios.get(`/referrals/codes/${referralCode}`);
            return response.data?.usages || [];
        }
        catch {
            // If code not found or no usages, return empty array
            return [];
        }
    }
}
exports.UserServiceClient = UserServiceClient;
class NotificationsServiceClient {
    constructor() {
        const baseUrl = (0, index_1.getRequiredEnvVar)('NOTIFICATIONS_SERVICE_URL');
        this.axios = axios_1.default.create({
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    async createNotification(data) {
        const response = await this.axios.post('/notifications', data);
        return response.data;
    }
    async sendNotificationToUser(data) {
        const response = await this.axios.post('/notifications/send-to-user', data);
        return response.data;
    }
}
exports.NotificationsServiceClient = NotificationsServiceClient;
class SwapServiceClient {
    constructor() {
        const baseUrl = (0, index_1.getRequiredEnvVar)('SWAP_SERVICE_URL');
        this.axios = axios_1.default.create({
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    async calculateReferralFees(referralCode, startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate)
            params.append('startDate', startDate.toISOString());
        if (endDate)
            params.append('endDate', endDate.toISOString());
        const url = `/swaps/referral-fees/${referralCode}${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await this.axios.get(url);
        return response.data;
    }
}
exports.SwapServiceClient = SwapServiceClient;
