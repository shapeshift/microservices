import * as crypto from 'crypto';
import { fromAccountId } from '@shapeshiftoss/caip';

// Hash utilities
export const hashAccountId = (accountId: string, salt?: string): string => {
  const defaultSalt = process.env.ACCOUNT_ID_SALT || 'default-salt-change-in-production';
  const saltToUse = salt || defaultSalt;
  return crypto.createHash('sha256').update(accountId + saltToUse).digest('hex');
};

// Validation utilities
export const isValidAccountId = (accountId: string): boolean => {
  try {
    // Try to parse using the library - this works for supported chains
    fromAccountId(accountId);
    return true;
  } catch (error) {
    // If library parsing fails, check if it at least matches CAIP-10 format
    // Format: chainNamespace:chainReference:accountAddress
    // Example: eip155:1:0x1234567890abcdef1234567890abcdef12345678
    const caip10Regex = /^[a-z0-9-]+:[a-z0-9-]+:0x[a-fA-F0-9]{40}$|^[a-z0-9-]+:[a-z0-9-]+:[a-zA-Z0-9]+$/;
    return caip10Regex.test(accountId);
  }
};

// Date utilities
export const formatDate = (date: Date): string => {
  return date.toISOString();
};

export const parseDate = (dateString: string): Date => {
  return new Date(dateString);
};

// Error utilities
export const createError = (message: string, code?: string, details?: any): Error => {
  const error = new Error(message);
  (error as any).code = code;
  (error as any).details = details;
  return error;
};

// Pagination utilities
export const createPaginatedResponse = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number
) => {
  return {
    data,
    total,
    page,
    limit,
    hasMore: page * limit < total
  };
};

// Environment utilities
export const getRequiredEnvVar = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
};

export const getOptionalEnvVar = (name: string, defaultValue?: string): string | undefined => {
  return process.env[name] || defaultValue;
};

// Service clients
export { UserServiceClient, NotificationsServiceClient } from './service-clients';
