"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapServiceClient = exports.NotificationsServiceClient = exports.UserServiceClient = exports.getOptionalEnvVar = exports.getRequiredEnvVar = exports.createPaginatedResponse = exports.createError = exports.parseDate = exports.formatDate = exports.isValidAccountId = exports.hashAccountId = void 0;
const crypto = __importStar(require("crypto"));
const caip_1 = require("@shapeshiftoss/caip");
// Hash utilities
const hashAccountId = (accountId, salt) => {
    const defaultSalt = process.env.ACCOUNT_ID_SALT || 'default-salt-change-in-production';
    const saltToUse = salt || defaultSalt;
    return crypto
        .createHash('sha256')
        .update(accountId + saltToUse)
        .digest('hex');
};
exports.hashAccountId = hashAccountId;
// Validation utilities
const isValidAccountId = (accountId) => {
    try {
        // Try to parse using the library - this works for supported chains
        (0, caip_1.fromAccountId)(accountId);
        return true;
    }
    catch {
        // If library parsing fails, check if it at least matches CAIP-10 format
        // Format: chainNamespace:chainReference:accountAddress
        // Examples:
        // - EVM: eip155:1:0x1234567890abcdef1234567890abcdef12345678
        // - Tron: tron:0x2b6653dc:TUrqPcjwrdz4u2tgSsrUoPHYYLe32u4Zea
        // - Bitcoin: bip122:000000000019d6689c085ae165831e93:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
        // - Solana: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK
        // - Cosmos: cosmos:cosmoshub-4:cosmos1..., cosmos:mayachain-mainnet:maya1...
        // More permissive CAIP-10 regex that handles various address formats
        const caip10Regex = /^[a-z0-9-]+:[a-z0-9-]+:[a-zA-Z0-9]+$/;
        return caip10Regex.test(accountId);
    }
};
exports.isValidAccountId = isValidAccountId;
// Date utilities
const formatDate = (date) => {
    return date.toISOString();
};
exports.formatDate = formatDate;
const parseDate = (dateString) => {
    return new Date(dateString);
};
exports.parseDate = parseDate;
const createError = (message, code, details) => {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
};
exports.createError = createError;
// Pagination utilities
const createPaginatedResponse = (data, total, page, limit) => {
    return {
        data,
        total,
        page,
        limit,
        hasMore: page * limit < total,
    };
};
exports.createPaginatedResponse = createPaginatedResponse;
// Environment utilities
const getRequiredEnvVar = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
};
exports.getRequiredEnvVar = getRequiredEnvVar;
const getOptionalEnvVar = (name, defaultValue) => {
    return process.env[name] || defaultValue;
};
exports.getOptionalEnvVar = getOptionalEnvVar;
// Service clients
var service_clients_1 = require("./service-clients");
Object.defineProperty(exports, "UserServiceClient", { enumerable: true, get: function () { return service_clients_1.UserServiceClient; } });
Object.defineProperty(exports, "NotificationsServiceClient", { enumerable: true, get: function () { return service_clients_1.NotificationsServiceClient; } });
Object.defineProperty(exports, "SwapServiceClient", { enumerable: true, get: function () { return service_clients_1.SwapServiceClient; } });
