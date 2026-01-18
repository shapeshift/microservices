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
  isAffiliateVerified?: boolean;
  affiliateVerificationDetails?: {
    hasAffiliate: boolean;
    affiliateBps?: number;
    affiliateAddress?: string;
  };
}

// Swap verification types
export interface SwapVerificationResult {
  isVerified: boolean;
  hasAffiliate: boolean;
  affiliateBps?: number;
  affiliateAddress?: string;
  protocol: string;
  swapId: string;
  details?: Record<string, any>;
  error?: string;
}

export interface VerifySwapAffiliateDto {
  swapId: string;
  protocol: string;
  txHash?: string;
}

// Multi-step routing types
export interface RouteStep {
  stepIndex: number;
  swapperName: string;
  sellAsset: Asset;
  buyAsset: Asset;
  sellAmountCryptoBaseUnit: string;
  expectedBuyAmountCryptoBaseUnit: string;
  feeUsd: string;
  slippagePercent: string;
  estimatedTimeSeconds: number;
}

export interface MultiStepRoute {
  totalSteps: number;
  estimatedOutputCryptoBaseUnit: string;
  estimatedOutputCryptoPrecision: string;
  totalFeesUsd: string;
  totalSlippagePercent: string;
  estimatedTimeSeconds: number;
  steps: RouteStep[];
}

export interface MultiStepQuoteRequest {
  sellAssetId: string;
  buyAssetId: string;
  sellAmountCryptoBaseUnit: string;
  userAddress: string;
  receiveAddress: string;
  maxHops?: number;
  maxCrossChainHops?: number;
}

export interface MultiStepQuoteResponse {
  success: boolean;
  route: MultiStepRoute | null;
  alternativeRoutes?: MultiStepRoute[];
  expiresAt: string;
  error?: string;
}

// Route constraints for configurable limits
export interface RouteConstraints {
  maxHops: number;
  maxCrossChainHops: number;
  maxSlippagePercent?: number;
  maxPriceImpactPercent?: number;
  allowedSwapperNames?: string[];
  excludedSwapperNames?: string[];
}

// Route configuration for system-wide settings
export interface RouteConfig {
  cacheTtlMs: number;
  quoteExpiryMs: number;
  priceImpactWarningPercent: number;
  priceImpactFlagPercent: number;
  defaultConstraints: RouteConstraints;
  maxAlternativeRoutes: number;
}
