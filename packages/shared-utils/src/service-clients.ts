import axios, { AxiosInstance } from 'axios';
import { getRequiredEnvVar } from './index';
import { User, Device, CreateNotificationDto } from '@shapeshift/shared-types';

export class UserServiceClient {
  private readonly axios: AxiosInstance;

  constructor() {
    const baseUrl = getRequiredEnvVar('USER_SERVICE_URL');
    this.axios = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getUserById(userId: string): Promise<User> {
    const response = await this.axios.get<User>(`/users/${userId}`);
    return response.data;
  }

  async getUserByAccountId(accountId: string): Promise<User> {
    const response = await this.axios.get<User>(`/users/account/${accountId}`);
    return response.data;
  }

  async getOrCreateUserByAccountIds(accountIds: string[]): Promise<User> {
    const response = await this.axios.post<User>('/users/get-or-create', { accountIds });
    return response.data;
  }

  async getUserDevices(userId: string): Promise<Device[]> {
    const response = await this.axios.get<Device[]>(`/users/${userId}/devices`);
    return response.data;
  }

  async getUserReferralCode(userId: string): Promise<string | null> {
    try {
      const user = await this.getUserById(userId);
      if (!user || !user.userAccounts || user.userAccounts.length === 0) {
        return null;
      }

      // Get the first account's hashed ID to check referral usage
      const hashedAccountId = user.userAccounts[0].accountId;
      const response = await this.axios.get<{ referralCode: string } | null>(
        `/referrals/usage/${hashedAccountId}`
      );
      return response.data?.referralCode || null;
    } catch (error) {
      // If no referral usage found, return null
      return null;
    }
  }
}

export class NotificationsServiceClient {
  private readonly axios: AxiosInstance;

  constructor() {
    const baseUrl = getRequiredEnvVar('NOTIFICATIONS_SERVICE_URL');
    this.axios = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async createNotification(data: CreateNotificationDto) {
    const response = await this.axios.post('/notifications', data);
    return response.data;
  }

  async sendNotificationToUser(data: {
    userId: string;
    title: string;
    body: string;
    data?: any;
  }) {
    const response = await this.axios.post('/notifications/send-to-user', data);
    return response.data;
  }
}

export class SwapServiceClient {
  private readonly axios: AxiosInstance;

  constructor() {
    const baseUrl = getRequiredEnvVar('SWAP_SERVICE_URL');
    this.axios = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async calculateReferralFees(referralCode: string, startDate?: Date, endDate?: Date) {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate.toISOString());
    if (endDate) params.append('endDate', endDate.toISOString());

    const url = `/swaps/referral-fees/${referralCode}${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await this.axios.get(url);
    return response.data;
  }
}
