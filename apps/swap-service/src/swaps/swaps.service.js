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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SwapsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const evm_service_1 = require("../lib/chain-adapters/evm.service");
const utxo_service_1 = require("../lib/chain-adapters/utxo.service");
const cosmos_sdk_service_1 = require("../lib/chain-adapters/cosmos-sdk.service");
const solana_service_1 = require("../lib/chain-adapters/solana.service");
const swap_verification_service_1 = require("../verification/swap-verification.service");
const swapper_1 = require("@shapeshiftoss/swapper");
const shared_utils_1 = require("@shapeshift/shared-utils");
const affiliateFeeAsset_1 = require("../utils/affiliateFeeAsset");
const shared_utils_2 = require("@shapeshift/shared-utils");
const chain_adapters_1 = require("@shapeshiftoss/chain-adapters");
const unchained_client_1 = require("@shapeshiftoss/unchained-client");
let SwapsService = SwapsService_1 = class SwapsService {
    constructor(prisma, evmChainAdapterService, utxoChainAdapterService, cosmosSdkChainAdapterService, solanaChainAdapterService, swapVerificationService) {
        this.prisma = prisma;
        this.evmChainAdapterService = evmChainAdapterService;
        this.utxoChainAdapterService = utxoChainAdapterService;
        this.cosmosSdkChainAdapterService = cosmosSdkChainAdapterService;
        this.solanaChainAdapterService = solanaChainAdapterService;
        this.swapVerificationService = swapVerificationService;
        this.logger = new common_1.Logger(SwapsService_1.name);
        this.notificationsClient = new shared_utils_2.NotificationsServiceClient();
        this.userServiceClient = new shared_utils_2.UserServiceClient();
    }
    async createSwap(data) {
        try {
            let referralCode = null;
            if (data.userId) {
                try {
                    referralCode = await this.userServiceClient.getUserReferralCode(data.userId);
                    if (referralCode) {
                        this.logger.log(`Found referral code ${referralCode} for user ${data.userId}`);
                    }
                }
                catch (error) {
                    this.logger.warn(`Failed to fetch referral code for user ${data.userId}:`, error);
                }
            }
            let sellAmountUsd = null;
            try {
                const { getAssetPriceUsd, calculateUsdValue } = await Promise.resolve().then(() => __importStar(require('../utils/pricing')));
                const price = await getAssetPriceUsd(data.sellAsset);
                if (price) {
                    sellAmountUsd = calculateUsdValue(data.sellAmountCryptoPrecision, price);
                }
            }
            catch (error) {
                this.logger.warn(`Failed to calculate sellAmountUsd for swap ${data.swapId}:`, error);
            }
            const affiliateFeeAssetId = (0, affiliateFeeAsset_1.resolveAffiliateFeeAssetId)(data.swapperName, data.sellAsset, data.buyAsset);
            const swap = await this.prisma.swap.create({
                data: {
                    swapId: data.swapId,
                    sellAsset: data.sellAsset,
                    buyAsset: data.buyAsset,
                    sellTxHash: data.sellTxHash || null,
                    sellAmountCryptoBaseUnit: data.sellAmountCryptoBaseUnit,
                    expectedBuyAmountCryptoBaseUnit: data.expectedBuyAmountCryptoBaseUnit,
                    sellAmountCryptoPrecision: data.sellAmountCryptoPrecision,
                    expectedBuyAmountCryptoPrecision: data.expectedBuyAmountCryptoPrecision,
                    source: data.source,
                    swapperName: data.swapperName,
                    sellAccountId: data.sellAccountId
                        ? (0, shared_utils_1.hashAccountId)(data.sellAccountId)
                        : 'api',
                    buyAccountId: data.buyAccountId
                        ? (0, shared_utils_1.hashAccountId)(data.buyAccountId)
                        : null,
                    receiveAddress: data.receiveAddress,
                    isStreaming: data.isStreaming || false,
                    metadata: data.metadata || {},
                    userId: data.userId || 'api',
                    referralCode,
                    sellAmountUsd,
                    affiliateAddress: data.affiliateAddress || null,
                    affiliateBps: data.affiliateBps || null,
                    origin: data.origin || null,
                    affiliateFeeAssetId,
                },
            });
            this.logger.log(`Swap created: ${swap.id}` +
                `${referralCode ? ` with referral code ${referralCode}` : ''}` +
                `${data.affiliateAddress ? ` with affiliate ${data.affiliateAddress}` : ''}` +
                `${sellAmountUsd ? ` ($${sellAmountUsd})` : ''}`);
            return swap;
        }
        catch (error) {
            this.logger.error('Failed to create swap', error);
            throw error;
        }
    }
    async updateSwapStatus(data) {
        try {
            const swap = await this.prisma.swap.update({
                where: { swapId: data.swapId },
                data: {
                    status: data.status,
                    sellTxHash: data.sellTxHash,
                    buyTxHash: data.buyTxHash,
                    txLink: data.txLink,
                    statusMessage: data.statusMessage,
                    actualBuyAmountCryptoPrecision: data.actualBuyAmountCryptoPrecision,
                },
            });
            await this.sendStatusUpdateNotification(swap);
            this.logger.log(`Swap status updated: ${swap.swapId} -> ${data.status}`);
            return {
                ...swap,
                sellAsset: swap.sellAsset,
                buyAsset: swap.buyAsset,
            };
        }
        catch (error) {
            this.logger.error('Failed to update swap status', error);
            throw error;
        }
    }
    formatAmount(amount) {
        // Convert to number with up to 8 decimals, then remove trailing zeros
        const num = (0, chain_adapters_1.bnOrZero)(amount).toFixed(8);
        // Remove trailing zeros and trailing decimal point
        return num.replace(/\.?0+$/, '');
    }
    async sendStatusUpdateNotification(swap) {
        let title;
        let body;
        let type;
        const sellAsset = swap.sellAsset;
        const buyAsset = swap.buyAsset;
        switch (swap.status) {
            case 'SUCCESS': {
                title = 'Swap Completed!';
                const buyAmount = this.formatAmount(swap.actualBuyAmountCryptoPrecision ||
                    swap.expectedBuyAmountCryptoPrecision);
                body = `Your swap of ${this.formatAmount(swap.sellAmountCryptoPrecision)} ${sellAsset.symbol} to ${buyAmount} ${buyAsset.symbol} is complete.`;
                type = 'SWAP_COMPLETED';
                break;
            }
            case 'FAILED':
                title = 'Swap Failed';
                body = `Your ${sellAsset.symbol} to ${buyAsset.symbol} swap has failed`;
                type = 'SWAP_FAILED';
                break;
            default:
                return;
        }
        if (swap.status === 'FAILED' || swap.status === 'SUCCESS') {
            await this.notificationsClient.createNotification({
                userId: swap.userId,
                title,
                body,
                type,
                swapId: swap.id,
            });
        }
    }
    async getSwapsByUser(userId, limit = 50) {
        const swaps = await this.prisma.swap.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return swaps.map((swap) => ({
            ...swap,
            sellAsset: swap.sellAsset,
            buyAsset: swap.buyAsset,
        }));
    }
    async getSwapsByAccountId(accountId) {
        const hashedAccountId = (0, shared_utils_1.hashAccountId)(accountId);
        const swaps = await this.prisma.swap.findMany({
            where: {
                OR: [
                    { sellAccountId: hashedAccountId },
                    { buyAccountId: hashedAccountId },
                ],
            },
        });
        return swaps.map((swap) => ({
            ...swap,
            sellAsset: swap.sellAsset,
            buyAsset: swap.buyAsset,
        }));
    }
    async getPendingSwaps() {
        const swaps = await this.prisma.swap.findMany({
            where: {
                status: {
                    in: ['IDLE', 'PENDING'],
                },
                sellTxHash: { not: null },
            },
        });
        return swaps.map((swap) => ({
            ...swap,
            sellAsset: swap.sellAsset,
            buyAsset: swap.buyAsset,
        }));
    }
    async calculateReferralFees(referralCode, startDate, endDate) {
        this.logger.log(`Calculating referral fees for code: ${referralCode}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`);
        // Fetch swaps for the current period
        const periodWhereClause = {
            referralCode,
            isAffiliateVerified: true,
            status: 'SUCCESS',
        };
        if (startDate && endDate) {
            periodWhereClause.createdAt = {
                gte: startDate,
                lte: endDate,
            };
        }
        const periodSwaps = await this.prisma.swap.findMany({
            where: periodWhereClause,
            select: {
                id: true,
                swapId: true,
                sellAsset: true,
                sellAmountCryptoPrecision: true,
                affiliateVerificationDetails: true,
                createdAt: true,
            },
        });
        // Fetch ALL swaps since the start (for total fees collected by referrer)
        const allTimeSwaps = await this.prisma.swap.findMany({
            where: {
                referralCode,
                isAffiliateVerified: true,
                status: 'SUCCESS',
            },
            select: {
                id: true,
                swapId: true,
                sellAsset: true,
                sellAmountCryptoPrecision: true,
                affiliateVerificationDetails: true,
                createdAt: true,
            },
        });
        this.logger.log(`Found ${periodSwaps.length} swaps for period, ${allTimeSwaps.length} swaps all-time for referral code ${referralCode}`);
        let periodFeesUsd = 0;
        let totalSwapVolumeUsd = 0;
        const swapCount = periodSwaps.length;
        // Import pricing utilities dynamically
        const { getAssetPriceUsd, calculateUsdValue } = await Promise.resolve().then(() => __importStar(require('../utils/pricing')));
        // Fetch prices for all unique assets from both period and all-time swaps
        const uniqueAssets = new Map();
        for (const swap of [...periodSwaps, ...allTimeSwaps]) {
            const sellAsset = swap.sellAsset;
            if (!uniqueAssets.has(sellAsset.assetId)) {
                uniqueAssets.set(sellAsset.assetId, sellAsset);
            }
        }
        // Fetch all prices in parallel
        const pricePromises = Array.from(uniqueAssets.values()).map(async (asset) => {
            const price = await getAssetPriceUsd(asset);
            return { assetId: asset.assetId, price };
        });
        const prices = await Promise.all(pricePromises);
        const priceMap = new Map();
        prices.forEach(({ assetId, price }) => {
            priceMap.set(assetId, price);
        });
        // Calculate period fees and volume
        for (const swap of periodSwaps) {
            const sellAsset = swap.sellAsset;
            const price = priceMap.get(sellAsset.assetId);
            if (!price) {
                this.logger.warn(`No price found for asset ${sellAsset.assetId}, skipping swap ${swap.swapId}`);
                continue;
            }
            const sellAmountUsd = parseFloat(calculateUsdValue(swap.sellAmountCryptoPrecision, price));
            totalSwapVolumeUsd += sellAmountUsd;
            // Extract affiliateBps from verification details
            const verificationDetails = swap.affiliateVerificationDetails;
            const affiliateBps = verificationDetails?.affiliateBps;
            if (affiliateBps && sellAmountUsd > 0) {
                // Fee = (sellAmountUsd × affiliateBps) / 10,000
                const feeUsd = (sellAmountUsd * affiliateBps) / 10000;
                periodFeesUsd += feeUsd;
            }
        }
        // Calculate all-time fees (for totalFeesCollectedUsd which represents total referrer earnings)
        let allTimeFeesUsd = 0;
        for (const swap of allTimeSwaps) {
            const sellAsset = swap.sellAsset;
            const price = priceMap.get(sellAsset.assetId);
            if (!price)
                continue;
            const sellAmountUsd = parseFloat(calculateUsdValue(swap.sellAmountCryptoPrecision, price));
            const verificationDetails = swap.affiliateVerificationDetails;
            const affiliateBps = verificationDetails?.affiliateBps;
            if (affiliateBps && sellAmountUsd > 0) {
                const feeUsd = (sellAmountUsd * affiliateBps) / 10000;
                allTimeFeesUsd += feeUsd;
            }
        }
        // Calculate referrer's 10% commission
        const periodReferrerCommissionUsd = periodFeesUsd * 0.1;
        const allTimeReferrerCommissionUsd = allTimeFeesUsd * 0.1;
        this.logger.log(`Referral fee calculation for ${referralCode}: ` +
            `Period: ${swapCount} swaps, $${totalSwapVolumeUsd.toFixed(2)} volume, $${periodReferrerCommissionUsd.toFixed(2)} commission | ` +
            `All-time: ${allTimeSwaps.length} swaps, $${allTimeReferrerCommissionUsd.toFixed(2)} total commission`);
        return {
            referralCode,
            swapCount,
            totalSwapVolumeUsd: totalSwapVolumeUsd.toFixed(2),
            totalFeesCollectedUsd: allTimeReferrerCommissionUsd.toFixed(2), // Total referrer earnings all-time
            referrerCommissionUsd: periodReferrerCommissionUsd.toFixed(2), // Period referrer earnings
            periodStart: startDate?.toISOString(),
            periodEnd: endDate?.toISOString(),
        };
    }
    getDistributionCutoff() {
        const now = new Date();
        const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5));
        if (now >= cutoff)
            return cutoff;
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5));
    }
    async resolveSwapUsdValue(swap, priceMap, freezeCutoff, calculateUsdValue) {
        const sellAsset = swap.sellAsset;
        const isFrozen = swap.createdAt < freezeCutoff;
        if (isFrozen && swap.sellAmountUsd) {
            return parseFloat(swap.sellAmountUsd);
        }
        const price = priceMap.get(sellAsset.assetId);
        if (!price) {
            this.logger.warn(`No price found for asset ${sellAsset.assetId}, skipping swap ${swap.swapId}`);
            return null;
        }
        const liveUsdValue = parseFloat(calculateUsdValue(swap.sellAmountCryptoPrecision, price));
        if (isFrozen && !swap.sellAmountUsd) {
            await this.prisma.swap.update({
                where: { id: swap.id },
                data: { sellAmountUsd: liveUsdValue.toFixed(2) },
            });
            this.logger.log(`Froze sellAmountUsd=${liveUsdValue.toFixed(2)} for swap ${swap.swapId} (pre-distribution)`);
        }
        return liveUsdValue;
    }
    async calculateAffiliateFees(affiliateAddress, startDate, endDate) {
        this.logger.log(`Calculating affiliate fees for address: ${affiliateAddress}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`);
        const freezeCutoff = this.getDistributionCutoff();
        this.logger.log(`Distribution freeze cutoff: ${freezeCutoff.toISOString()}`);
        const periodWhereClause = {
            affiliateAddress,
            isAffiliateVerified: true,
            status: 'SUCCESS',
        };
        if (startDate && endDate) {
            periodWhereClause.createdAt = {
                gte: startDate,
                lte: endDate,
            };
        }
        const swapSelect = {
            id: true,
            swapId: true,
            swapperName: true,
            sellAsset: true,
            buyAsset: true,
            sellAmountCryptoBaseUnit: true,
            sellAmountCryptoPrecision: true,
            expectedBuyAmountCryptoBaseUnit: true,
            sellAmountUsd: true,
            affiliateBps: true,
            origin: true,
            affiliateFeeAssetId: true,
            affiliateFeeAmountCryptoBaseUnit: true,
            affiliateVerificationDetails: true,
            createdAt: true,
        };
        const periodSwaps = await this.prisma.swap.findMany({
            where: periodWhereClause,
            select: swapSelect,
        });
        const allTimeSwaps = await this.prisma.swap.findMany({
            where: {
                affiliateAddress,
                isAffiliateVerified: true,
                status: 'SUCCESS',
            },
            select: swapSelect,
        });
        this.logger.log(`Found ${periodSwaps.length} swaps for period, ${allTimeSwaps.length} swaps all-time for affiliate ${affiliateAddress}`);
        const { getAssetPriceUsd, calculateUsdValue } = await Promise.resolve().then(() => __importStar(require('../utils/pricing')));
        const uniqueAssets = new Map();
        for (const swap of [...periodSwaps, ...allTimeSwaps]) {
            const sellAsset = swap.sellAsset;
            const buyAsset = swap.buyAsset;
            if (!uniqueAssets.has(sellAsset.assetId)) {
                uniqueAssets.set(sellAsset.assetId, sellAsset);
            }
            if (!uniqueAssets.has(buyAsset.assetId)) {
                uniqueAssets.set(buyAsset.assetId, buyAsset);
            }
        }
        const pricePromises = Array.from(uniqueAssets.values()).map(async (asset) => {
            const price = await getAssetPriceUsd(asset);
            return { assetId: asset.assetId, price };
        });
        const prices = await Promise.all(pricePromises);
        const priceMap = new Map();
        prices.forEach(({ assetId, price }) => {
            priceMap.set(assetId, price);
        });
        let periodCommissionUsd = 0;
        let totalSwapVolumeUsd = 0;
        const swapCount = periodSwaps.length;
        for (const swap of periodSwaps) {
            const sellAmountUsd = await this.resolveSwapUsdValue(swap, priceMap, freezeCutoff, calculateUsdValue);
            if (sellAmountUsd === null)
                continue;
            totalSwapVolumeUsd += sellAmountUsd;
            const verificationDetails = swap.affiliateVerificationDetails;
            const verifiedBps = verificationDetails?.affiliateBps;
            if (verifiedBps && sellAmountUsd > 0) {
                const commissionRate = this.getAffiliateCommissionRate(swap.origin, verifiedBps);
                const verifiedSell = verificationDetails?.verifiedSellAmountCryptoBaseUnit;
                const effectiveSellAmount = verifiedSell
                    ? (0, chain_adapters_1.bnOrZero)(verifiedSell).lt((0, chain_adapters_1.bnOrZero)(swap.sellAmountCryptoBaseUnit))
                        ? verifiedSell
                        : swap.sellAmountCryptoBaseUnit
                    : swap.sellAmountCryptoBaseUnit;
                let totalFeeUsd;
                const feeAssetId = swap.affiliateFeeAssetId;
                const feeAssetPrice = feeAssetId ? priceMap.get(feeAssetId) : null;
                if (feeAssetId && feeAssetPrice) {
                    const sellAssetObj = swap.sellAsset;
                    const buyAssetObj = swap.buyAsset;
                    const feeAmountBaseUnit = this.estimateAffiliateFeeAmount(verifiedBps, swap.swapperName, effectiveSellAmount, swap.expectedBuyAmountCryptoBaseUnit);
                    const feeAssetPrecision = feeAssetId === sellAssetObj.assetId
                        ? sellAssetObj.precision
                        : buyAssetObj.precision;
                    const feeAmountHuman = parseFloat(feeAmountBaseUnit) / Math.pow(10, feeAssetPrecision);
                    totalFeeUsd = feeAmountHuman * feeAssetPrice;
                }
                else {
                    totalFeeUsd = (sellAmountUsd * verifiedBps) / 10000;
                }
                periodCommissionUsd += totalFeeUsd * commissionRate;
            }
        }
        let allTimeCommissionUsd = 0;
        for (const swap of allTimeSwaps) {
            const sellAmountUsd = await this.resolveSwapUsdValue(swap, priceMap, freezeCutoff, calculateUsdValue);
            if (sellAmountUsd === null)
                continue;
            const verificationDetails = swap.affiliateVerificationDetails;
            const verifiedBps = verificationDetails?.affiliateBps;
            if (verifiedBps && sellAmountUsd > 0) {
                const commissionRate = this.getAffiliateCommissionRate(swap.origin, verifiedBps);
                const verifiedSell = verificationDetails?.verifiedSellAmountCryptoBaseUnit;
                const effectiveSellAmount = verifiedSell
                    ? (0, chain_adapters_1.bnOrZero)(verifiedSell).lt((0, chain_adapters_1.bnOrZero)(swap.sellAmountCryptoBaseUnit))
                        ? verifiedSell
                        : swap.sellAmountCryptoBaseUnit
                    : swap.sellAmountCryptoBaseUnit;
                let totalFeeUsd;
                const feeAssetId = swap.affiliateFeeAssetId;
                const feeAssetPrice = feeAssetId ? priceMap.get(feeAssetId) : null;
                if (feeAssetId && feeAssetPrice) {
                    const sellAssetObj = swap.sellAsset;
                    const buyAssetObj = swap.buyAsset;
                    const feeAmountBaseUnit = this.estimateAffiliateFeeAmount(verifiedBps, swap.swapperName, effectiveSellAmount, swap.expectedBuyAmountCryptoBaseUnit);
                    const feeAssetPrecision = feeAssetId === sellAssetObj.assetId
                        ? sellAssetObj.precision
                        : buyAssetObj.precision;
                    const feeAmountHuman = parseFloat(feeAmountBaseUnit) / Math.pow(10, feeAssetPrecision);
                    totalFeeUsd = feeAmountHuman * feeAssetPrice;
                }
                else {
                    totalFeeUsd = (sellAmountUsd * verifiedBps) / 10000;
                }
                allTimeCommissionUsd += totalFeeUsd * commissionRate;
            }
        }
        this.logger.log(`Affiliate fee calculation for ${affiliateAddress}: ` +
            `Period: ${swapCount} swaps, $${totalSwapVolumeUsd.toFixed(2)} volume, $${periodCommissionUsd.toFixed(2)} commission | ` +
            `All-time: ${allTimeSwaps.length} swaps, $${allTimeCommissionUsd.toFixed(2)} total commission`);
        return {
            affiliateAddress,
            swapCount,
            totalSwapVolumeUsd: totalSwapVolumeUsd.toFixed(2),
            totalFeesCollectedUsd: allTimeCommissionUsd.toFixed(2),
            referrerCommissionUsd: periodCommissionUsd.toFixed(2),
            periodStart: startDate?.toISOString(),
            periodEnd: endDate?.toISOString(),
        };
    }
    getAffiliateCommissionRate(origin, verifiedBps) {
        if (origin === 'web') {
            return SwapsService_1.WEB_REVENUE_SHARE;
        }
        if (!origin || verifiedBps <= SwapsService_1.API_BASE_BPS)
            return 0;
        return (verifiedBps - SwapsService_1.API_BASE_BPS) / verifiedBps;
    }
    estimateAffiliateFeeAmount(affiliateBps, swapperName, sellAmountCryptoBaseUnit, expectedBuyAmountCryptoBaseUnit) {
        const strategy = (0, affiliateFeeAsset_1.getSwapperFeeStrategy)(swapperName);
        const bpsMultiplier = affiliateBps / 10000;
        switch (strategy) {
            case 'sell_asset':
                return (0, chain_adapters_1.bnOrZero)(sellAmountCryptoBaseUnit)
                    .times(bpsMultiplier)
                    .toFixed(0);
            case 'buy_asset':
                return (0, chain_adapters_1.bnOrZero)(expectedBuyAmountCryptoBaseUnit)
                    .times(bpsMultiplier)
                    .toFixed(0);
            case 'fixed_base':
            default:
                return (0, chain_adapters_1.bnOrZero)(sellAmountCryptoBaseUnit)
                    .times(bpsMultiplier)
                    .toFixed(0);
        }
    }
    async pollSwapStatus(swapId) {
        try {
            this.logger.log(`Polling status for swap: ${swapId}`);
            const swap = await this.prisma.swap.findUnique({
                where: { swapId },
            });
            if (!swap) {
                throw new Error(`Swap not found: ${swapId}`);
            }
            const sellAsset = swap.sellAsset;
            const swapper = swapper_1.swappers[swap.swapperName];
            if (!swapper) {
                throw new Error(`Swapper not found: ${swap.swapperName}`);
            }
            if (!swap.sellTxHash) {
                throw new Error('Sell tx hash is required');
            }
            const status = await swapper.checkTradeStatus({
                txHash: swap.sellTxHash ?? '',
                chainId: sellAsset.chainId,
                address: swap.sellAccountId,
                swap: {
                    ...swap,
                    id: swap.swapId,
                    createdAt: swap.createdAt.getTime(),
                    updatedAt: swap.updatedAt.getTime(),
                },
                stepIndex: 0,
                config: {
                    VITE_UNCHAINED_THORCHAIN_HTTP_URL: process.env.VITE_UNCHAINED_THORCHAIN_HTTP_URL || '',
                    VITE_UNCHAINED_MAYACHAIN_HTTP_URL: process.env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL || '',
                    VITE_UNCHAINED_COSMOS_HTTP_URL: process.env.VITE_UNCHAINED_COSMOS_HTTP_URL || '',
                    VITE_THORCHAIN_NODE_URL: process.env.VITE_THORCHAIN_NODE_URL || '',
                    VITE_MAYACHAIN_NODE_URL: process.env.VITE_MAYACHAIN_NODE_URL || '',
                    VITE_COWSWAP_BASE_URL: process.env.VITE_COWSWAP_BASE_URL || '',
                    VITE_CHAINFLIP_API_KEY: process.env.VITE_CHAINFLIP_API_KEY || '',
                    VITE_CHAINFLIP_API_URL: process.env.VITE_CHAINFLIP_API_URL || '',
                    VITE_JUPITER_API_URL: process.env.VITE_JUPITER_API_URL || '',
                    VITE_RELAY_API_URL: process.env.VITE_RELAY_API_URL || '',
                    VITE_PORTALS_BASE_URL: process.env.VITE_PORTALS_BASE_URL || '',
                    VITE_ZRX_BASE_URL: process.env.VITE_ZRX_BASE_URL || '',
                    VITE_THORCHAIN_MIDGARD_URL: process.env.VITE_THORCHAIN_MIDGARD_URL || '',
                    VITE_MAYACHAIN_MIDGARD_URL: process.env.VITE_MAYACHAIN_MIDGARD_URL || '',
                    VITE_UNCHAINED_BITCOIN_HTTP_URL: process.env.VITE_UNCHAINED_BITCOIN_HTTP_URL || '',
                    VITE_UNCHAINED_DOGECOIN_HTTP_URL: process.env.VITE_UNCHAINED_DOGECOIN_HTTP_URL || '',
                    VITE_UNCHAINED_LITECOIN_HTTP_URL: process.env.VITE_UNCHAINED_LITECOIN_HTTP_URL || '',
                    VITE_UNCHAINED_BITCOINCASH_HTTP_URL: process.env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL || '',
                    VITE_UNCHAINED_ETHEREUM_HTTP_URL: process.env.VITE_UNCHAINED_ETHEREUM_HTTP_URL || '',
                    VITE_UNCHAINED_AVALANCHE_HTTP_URL: process.env.VITE_UNCHAINED_AVALANCHE_HTTP_URL || '',
                    VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL: process.env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL || '',
                    VITE_UNCHAINED_BASE_HTTP_URL: process.env.VITE_UNCHAINED_BASE_HTTP_URL || '',
                    VITE_NEAR_INTENTS_API_KEY: process.env.VITE_NEAR_INTENTS_API_KEY || '',
                    VITE_FEATURE_THORCHAINSWAP_LONGTAIL: true,
                    VITE_FEATURE_THORCHAINSWAP_L1_TO_LONGTAIL: true,
                    VITE_FEATURE_CHAINFLIP_SWAP_DCA: true,
                },
                assertGetSolanaChainAdapter: (chainId) => {
                    return this.solanaChainAdapterService.assertGetSolanaChainAdapter(chainId);
                },
                assertGetUtxoChainAdapter: (chainId) => {
                    return this.utxoChainAdapterService.assertGetUtxoChainAdapter(chainId);
                },
                assertGetCosmosSdkChainAdapter: (chainId) => {
                    return this.cosmosSdkChainAdapterService.assertGetCosmosSdkChainAdapter(chainId);
                },
                assertGetEvmChainAdapter: (chainId) => {
                    return this.evmChainAdapterService.assertGetEvmChainAdapter(chainId);
                },
                fetchIsSmartContractAddressQuery: () => Promise.resolve(false),
            });
            // Verify affiliate usage
            let isAffiliateVerified;
            let affiliateVerificationDetails;
            try {
                // Enrich metadata with swap fields needed for verification
                const enrichedMetadata = {
                    ...swap.metadata,
                    receiveAddress: swap.receiveAddress,
                    expectedBuyAmountCryptoPrecision: swap.expectedBuyAmountCryptoPrecision,
                    createdAt: swap.createdAt.getTime(),
                    sellAssetPrecision: sellAsset.precision,
                };
                const verificationResult = await this.swapVerificationService.verifySwapAffiliate(swapId, swap.swapperName, sellAsset.chainId, swap.sellTxHash || undefined, enrichedMetadata);
                isAffiliateVerified =
                    verificationResult.isVerified && verificationResult.hasAffiliate;
                if (verificationResult.isVerified) {
                    affiliateVerificationDetails = {
                        hasAffiliate: verificationResult.hasAffiliate,
                        affiliateBps: verificationResult.affiliateBps,
                        affiliateAddress: verificationResult.affiliateAddress,
                        verifiedSellAmountCryptoBaseUnit: verificationResult.verifiedSellAmountCryptoBaseUnit,
                    };
                }
                this.logger.log(`Affiliate verification for swap ${swapId}: verified=${verificationResult.isVerified}, hasAffiliate=${verificationResult.hasAffiliate}`);
                // Update the database with verification result
                await this.prisma.swap.update({
                    where: { swapId },
                    data: {
                        isAffiliateVerified,
                        affiliateVerificationDetails: affiliateVerificationDetails || {},
                        affiliateVerifiedAt: new Date(),
                    },
                });
            }
            catch (verificationError) {
                this.logger.warn(`Failed to verify affiliate for swap ${swapId}:`, verificationError);
                // Don't fail the entire status check if verification fails
            }
            return {
                status: status.status === unchained_client_1.TxStatus.Confirmed
                    ? 'SUCCESS'
                    : status.status === unchained_client_1.TxStatus.Failed
                        ? 'FAILED'
                        : 'PENDING',
                sellTxHash: swap.sellTxHash,
                buyTxHash: status.buyTxHash,
                statusMessage: status.message,
                isAffiliateVerified,
                affiliateVerificationDetails,
            };
        }
        catch (error) {
            this.logger.error(`Failed to poll swap status for ${swapId}:`, error);
            return {
                status: 'PENDING',
                statusMessage: `Error polling status: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
        }
    }
};
exports.SwapsService = SwapsService;
SwapsService.API_BASE_BPS = 10;
SwapsService.WEB_REVENUE_SHARE = 0.1;
exports.SwapsService = SwapsService = SwapsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        evm_service_1.EvmChainAdapterService,
        utxo_service_1.UtxoChainAdapterService,
        cosmos_sdk_service_1.CosmosSdkChainAdapterService,
        solana_service_1.SolanaChainAdapterService,
        swap_verification_service_1.SwapVerificationService])
], SwapsService);
