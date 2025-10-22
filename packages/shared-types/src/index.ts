import { Asset } from '@shapeshiftoss/types';

export type DeviceType = 'MOBILE' | 'WEB';
export type SwapStatus = 'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED';
export type NotificationType = 'SWAP_STATUS_UPDATE' | 'SWAP_COMPLETED' | 'SWAP_FAILED';

export interface Device {
  id: string;
  deviceToken: string;
  deviceType: DeviceType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export interface User {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userAccounts: UserAccount[];
  devices: Device[];
}

export interface UserAccount {
  id: string;
  accountId: string;
  createdAt: Date;
  userId: string;
}

export interface CreateUserDto {
  accountIds: string[];
}

export interface AddAccountIdDto {
  userId: string;
  accountId: string;
}

export interface RegisterDeviceDto {
  userId: string;
  deviceToken: string;
  deviceType: DeviceType;
}

export interface CreateNotificationDto {
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  swapId?: string;
  deviceId?: string;
}

export interface PushNotificationData {
  notificationId?: string;
  type?: string;
  swapId?: string;
  [key: string]: any;
}

export interface CreateSwapDto {
  swapId: string;
  userId: string;
  sellAsset: Asset;
  buyAsset: Asset;
  sellTxHash: string;
  sellAmountCryptoBaseUnit: string;
  expectedBuyAmountCryptoBaseUnit: string;
  sellAmountCryptoPrecision: string;
  expectedBuyAmountCryptoPrecision: string;
  source: string;
  swapperName: string;
  sellAccountId: string;
  buyAccountId?: string;
  receiveAddress?: string;
  isStreaming?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateSwapStatusDto {
  swapId: string;
  status: SwapStatus;
  sellTxHash?: string;
  buyTxHash?: string;
  txLink?: string;
  statusMessage?: string;
  actualBuyAmountCryptoPrecision?: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SwapStatusResponse {
  status: 'IDLE' | 'PENDING' | 'SUCCESS' | 'FAILED';
  sellTxHash?: string;
  buyTxHash?: string;
  statusMessage: string;
}
