import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Swap } from '@prisma/client';
import { EvmChainAdapterService } from '../lib/chain-adapters/evm.service';
import { UtxoChainAdapterService } from '../lib/chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from '../lib/chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from '../lib/chain-adapters/solana.service';
import { TronChainAdapterService } from '../lib/chain-adapters/tron.service';
import { SuiChainAdapterService } from '../lib/chain-adapters/sui.service';
import { NearChainAdapterService } from '../lib/chain-adapters/near.service';
import { StarknetChainAdapterService } from '../lib/chain-adapters/starknet.service';
import { TonChainAdapterService } from '../lib/chain-adapters/ton.service';
import { SwapVerificationService } from '../verification/swap-verification.service';
import {
  SwapperName,
  swappers,
  type Swap as SwapperSwap,
} from '@shapeshiftoss/swapper';
import { ChainId } from '@shapeshiftoss/caip';
import { Asset } from '@shapeshiftoss/types';
import { hashAccountId } from '@shapeshift/shared-utils';
import {
  resolveAffiliateFeeAssetId,
  getSwapperFeeStrategy,
} from '../utils/affiliateFeeAsset';
import {
  NotificationsServiceClient,
  UserServiceClient,
} from '@shapeshift/shared-utils';
import {
  CreateSwapDto,
  SwapStatusResponse,
  UpdateSwapStatusDto,
} from '@shapeshift/shared-types';
import { bnOrZero } from '@shapeshiftoss/chain-adapters';
import { TxStatus } from '@shapeshiftoss/unchained-client';

type AffiliateVerificationDetails = {
  affiliateBps?: number;
  affiliateAddress?: string;
  verifiedSellAmountCryptoBaseUnit?: string;
  hasAffiliate?: boolean;
};

export type SwapWithAssets = Omit<Swap, 'sellAsset' | 'buyAsset'> & {
  sellAsset: Asset;
  buyAsset: Asset;
};

@Injectable()
export class SwapsService {
  private readonly logger = new Logger(SwapsService.name);
  private readonly notificationsClient: NotificationsServiceClient;
  private readonly userServiceClient: UserServiceClient;

  constructor(
    private prisma: PrismaService,
    private evmChainAdapterService: EvmChainAdapterService,
    private utxoChainAdapterService: UtxoChainAdapterService,
    private cosmosSdkChainAdapterService: CosmosSdkChainAdapterService,
    private solanaChainAdapterService: SolanaChainAdapterService,
    private tronChainAdapterService: TronChainAdapterService,
    private suiChainAdapterService: SuiChainAdapterService,
    private nearChainAdapterService: NearChainAdapterService,
    private starknetChainAdapterService: StarknetChainAdapterService,
    private tonChainAdapterService: TonChainAdapterService,
    private swapVerificationService: SwapVerificationService,
  ) {
    this.notificationsClient = new NotificationsServiceClient();
    this.userServiceClient = new UserServiceClient();
  }

  async createSwap(data: CreateSwapDto) {
    try {
      let referralCode: string | null = null;
      if (data.userId) {
        try {
          referralCode = await this.userServiceClient.getUserReferralCode(
            data.userId,
          );
          if (referralCode) {
            this.logger.log(
              `Found referral code ${referralCode} for user ${data.userId}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to fetch referral code for user ${data.userId}:`,
            error,
          );
        }
      }

      let sellAmountUsd: string | null = null;
      try {
        const { getAssetPriceUsd, calculateUsdValue } = await import(
          '../utils/pricing'
        );
        const price = await getAssetPriceUsd(data.sellAsset);
        if (price) {
          sellAmountUsd = calculateUsdValue(
            data.sellAmountCryptoPrecision,
            price,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to calculate sellAmountUsd for swap ${data.swapId}:`,
          error,
        );
      }

      if (!sellAmountUsd && data.sellAmountUsd) {
        sellAmountUsd = data.sellAmountUsd;
      }

      let affiliateAddress = data.affiliateAddress || null;
      if (!affiliateAddress && data.partnerCode) {
        try {
          const affiliate = await this.prisma.affiliate.findFirst({
            where: { partnerCode: data.partnerCode },
            select: { receiveAddress: true, walletAddress: true },
          });
          if (affiliate) {
            affiliateAddress =
              affiliate.receiveAddress ?? affiliate.walletAddress;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to resolve partner code ${data.partnerCode}:`,
            error,
          );
        }
      }

      const affiliateFeeAssetId = resolveAffiliateFeeAssetId(
        data.swapperName,
        data.sellAsset,
        data.buyAsset,
      );

      const metadata = (data.metadata || {}) as Record<string, unknown>;
      const relayMeta = (metadata.relayTransactionMetadata ??
        (metadata.relayId ? { relayId: metadata.relayId } : undefined)) as
        | Prisma.InputJsonValue
        | undefined;
      const chainflipId =
        typeof metadata.chainflipSwapId === 'number'
          ? metadata.chainflipSwapId
          : undefined;

      const swap = await this.prisma.swap.create({
        data: {
          swapId: data.swapId,
          sellAsset: data.sellAsset,
          buyAsset: data.buyAsset,
          sellTxHash: data.sellTxHash || null,
          sellAmountCryptoBaseUnit: data.sellAmountCryptoBaseUnit,
          expectedBuyAmountCryptoBaseUnit: data.expectedBuyAmountCryptoBaseUnit,
          sellAmountCryptoPrecision: data.sellAmountCryptoPrecision,
          expectedBuyAmountCryptoPrecision:
            data.expectedBuyAmountCryptoPrecision,
          source: data.source,
          swapperName: data.swapperName,
          sellAccountId: data.sellAccountId
            ? hashAccountId(data.sellAccountId)
            : 'api',
          buyAccountId: data.buyAccountId
            ? hashAccountId(data.buyAccountId)
            : null,
          receiveAddress: data.receiveAddress,
          isStreaming: data.isStreaming || false,
          metadata: data.metadata || {},
          userId: data.userId || 'api',
          referralCode,
          sellAmountUsd,
          affiliateAddress: affiliateAddress,
          affiliateBps: data.affiliateBps || null,
          origin: data.origin || null,
          shapeshiftBps: SwapsService.API_BASE_BPS,
          affiliateFeeAssetId,
          relayTransactionMetadata: relayMeta ?? undefined,
          chainflipSwapId: chainflipId ?? undefined,
        },
      });

      this.logger.log(
        `Swap created: ${swap.id}` +
          `${referralCode ? ` with referral code ${referralCode}` : ''}` +
          `${data.affiliateAddress ? ` with affiliate ${data.affiliateAddress}` : ''}` +
          `${sellAmountUsd ? ` ($${sellAmountUsd})` : ''}`,
      );
      return swap;
    } catch (error) {
      this.logger.error('Failed to create swap', error);
      throw error;
    }
  }

  async updateSwapStatus(data: UpdateSwapStatusDto): Promise<SwapWithAssets> {
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

      try {
        await this.sendStatusUpdateNotification(swap);
      } catch (notifError) {
        this.logger.error(
          `Failed to send notification for swap ${data.swapId}:`,
          notifError,
        );
      }

      this.logger.log(`Swap status updated: ${swap.swapId} -> ${data.status}`);
      return {
        ...swap,
        sellAsset: swap.sellAsset as Asset,
        buyAsset: swap.buyAsset as Asset,
      };
    } catch (error) {
      this.logger.error('Failed to update swap status', error);
      throw error;
    }
  }

  private formatAmount(amount: string | number): string {
    // Convert to number with up to 8 decimals, then remove trailing zeros
    const num = bnOrZero(amount).toFixed(8);
    // Remove trailing zeros and trailing decimal point
    return num.replace(/\.?0+$/, '');
  }

  private async sendStatusUpdateNotification(
    swap: Pick<
      Swap,
      | 'id'
      | 'userId'
      | 'status'
      | 'sellAsset'
      | 'buyAsset'
      | 'sellAmountCryptoPrecision'
      | 'actualBuyAmountCryptoPrecision'
      | 'expectedBuyAmountCryptoPrecision'
    >,
  ) {
    let title: string;
    let body: string;
    let type: 'SWAP_STATUS_UPDATE' | 'SWAP_COMPLETED' | 'SWAP_FAILED';

    const sellAsset = swap.sellAsset as Asset;
    const buyAsset = swap.buyAsset as Asset;

    switch (swap.status) {
      case 'SUCCESS': {
        title = 'Swap Completed!';
        const buyAmount = this.formatAmount(
          swap.actualBuyAmountCryptoPrecision ||
            swap.expectedBuyAmountCryptoPrecision,
        );
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

  async getSwapsByUser(userId: string, limit = 50) {
    const swaps = await this.prisma.swap.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return swaps.map((swap) => ({
      ...swap,
      sellAsset: swap.sellAsset as Asset,
      buyAsset: swap.buyAsset as Asset,
    }));
  }

  async getSwapsByAccountId(accountId: string) {
    const hashedAccountId = hashAccountId(accountId);
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

  async calculateReferralFees(
    referralCode: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    this.logger.log(
      `Calculating referral fees for code: ${referralCode}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`,
    );

    // Fetch swaps for the current period
    const periodWhereClause: Prisma.SwapWhereInput = {
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

    this.logger.log(
      `Found ${periodSwaps.length} swaps for period, ${allTimeSwaps.length} swaps all-time for referral code ${referralCode}`,
    );

    let periodFeesUsd = 0;
    let totalSwapVolumeUsd = 0;
    const swapCount = periodSwaps.length;

    // Import pricing utilities dynamically
    const { getAssetPriceUsd, calculateUsdValue } = await import(
      '../utils/pricing'
    );

    // Fetch prices for all unique assets from both period and all-time swaps
    const uniqueAssets = new Map<string, Asset>();
    for (const swap of [...periodSwaps, ...allTimeSwaps]) {
      const sellAsset = swap.sellAsset as Asset;
      if (!uniqueAssets.has(sellAsset.assetId)) {
        uniqueAssets.set(sellAsset.assetId, sellAsset);
      }
    }

    // Fetch prices in batches to respect CoinGecko rate limits
    const BATCH_SIZE = 5;
    const allReferralAssets = Array.from(uniqueAssets.values());
    const priceMap = new Map<string, number | null>();
    for (let i = 0; i < allReferralAssets.length; i += BATCH_SIZE) {
      const batch = allReferralAssets.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (asset) => {
          const price = await getAssetPriceUsd(asset);
          return { assetId: asset.assetId, price };
        }),
      );
      batchResults.forEach(({ assetId, price }) => {
        priceMap.set(assetId, price);
      });
    }

    // Calculate period fees and volume
    for (const swap of periodSwaps) {
      const sellAsset = swap.sellAsset as Asset;
      const price = priceMap.get(sellAsset.assetId);

      if (!price) {
        this.logger.warn(
          `No price found for asset ${sellAsset.assetId}, skipping swap ${swap.swapId}`,
        );
        continue;
      }

      const sellAmountUsd = parseFloat(
        calculateUsdValue(swap.sellAmountCryptoPrecision, price),
      );
      totalSwapVolumeUsd += sellAmountUsd;

      // Extract affiliateBps from verification details
      const verificationDetails =
        swap.affiliateVerificationDetails as AffiliateVerificationDetails | null;
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
      const sellAsset = swap.sellAsset as Asset;
      const price = priceMap.get(sellAsset.assetId);

      if (!price) continue;

      const sellAmountUsd = parseFloat(
        calculateUsdValue(swap.sellAmountCryptoPrecision, price),
      );
      const verificationDetails =
        swap.affiliateVerificationDetails as AffiliateVerificationDetails | null;
      const affiliateBps = verificationDetails?.affiliateBps;

      if (affiliateBps && sellAmountUsd > 0) {
        const feeUsd = (sellAmountUsd * affiliateBps) / 10000;
        allTimeFeesUsd += feeUsd;
      }
    }

    // Calculate referrer's 10% commission
    const periodReferrerCommissionUsd = periodFeesUsd * 0.1;
    const allTimeReferrerCommissionUsd = allTimeFeesUsd * 0.1;

    this.logger.log(
      `Referral fee calculation for ${referralCode}: ` +
        `Period: ${swapCount} swaps, $${totalSwapVolumeUsd.toFixed(2)} volume, $${periodReferrerCommissionUsd.toFixed(2)} commission | ` +
        `All-time: ${allTimeSwaps.length} swaps, $${allTimeReferrerCommissionUsd.toFixed(2)} total commission`,
    );

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

  private getDistributionCutoff(): Date {
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5),
    );
    if (now >= cutoff) return cutoff;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5));
  }

  private async resolveSwapUsdValue(
    swap: {
      id: string;
      swapId: string;
      sellAsset: unknown;
      sellAmountCryptoPrecision: string;
      sellAmountUsd: string | null;
      createdAt: Date;
    },
    priceMap: Map<string, number | null>,
    freezeCutoff: Date,
    calculateUsdValue: (amount: string, price: number) => string,
  ): Promise<number | null> {
    const sellAsset = swap.sellAsset as Asset;
    const isFrozen = swap.createdAt < freezeCutoff;

    if (isFrozen && swap.sellAmountUsd) {
      return parseFloat(swap.sellAmountUsd);
    }

    const price = priceMap.get(sellAsset.assetId);
    if (!price) {
      this.logger.warn(
        `No price found for asset ${sellAsset.assetId}, skipping swap ${swap.swapId}`,
      );
      return null;
    }

    const liveUsdValue = parseFloat(
      calculateUsdValue(swap.sellAmountCryptoPrecision, price),
    );

    if (isFrozen && !swap.sellAmountUsd) {
      await this.prisma.swap.update({
        where: { id: swap.id },
        data: { sellAmountUsd: liveUsdValue.toFixed(2) },
      });
      this.logger.log(
        `Froze sellAmountUsd=${liveUsdValue.toFixed(2)} for swap ${swap.swapId} (pre-distribution)`,
      );
    }

    return liveUsdValue;
  }

  async calculateAffiliateFees(
    affiliateAddress: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    this.logger.log(
      `Calculating affiliate fees for address: ${affiliateAddress}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`,
    );

    const freezeCutoff = this.getDistributionCutoff();
    this.logger.log(
      `Distribution freeze cutoff: ${freezeCutoff.toISOString()}`,
    );

    const periodWhereClause: Prisma.SwapWhereInput = {
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
      shapeshiftBps: true,
    } as const;

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

    this.logger.log(
      `Found ${periodSwaps.length} swaps for period, ${allTimeSwaps.length} swaps all-time for affiliate ${affiliateAddress}`,
    );

    const { getAssetPriceUsd, calculateUsdValue } = await import(
      '../utils/pricing'
    );

    const uniqueAssets = new Map<string, Asset>();
    for (const swap of [...periodSwaps, ...allTimeSwaps]) {
      const sellAsset = swap.sellAsset as Asset;
      const buyAsset = swap.buyAsset as Asset;
      if (!uniqueAssets.has(sellAsset.assetId)) {
        uniqueAssets.set(sellAsset.assetId, sellAsset);
      }
      if (!uniqueAssets.has(buyAsset.assetId)) {
        uniqueAssets.set(buyAsset.assetId, buyAsset);
      }
    }

    const BATCH_SIZE = 5;
    const allAffiliateAssets = Array.from(uniqueAssets.values());
    const priceMap = new Map<string, number | null>();
    for (let i = 0; i < allAffiliateAssets.length; i += BATCH_SIZE) {
      const batch = allAffiliateAssets.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (asset) => {
          const price = await getAssetPriceUsd(asset);
          return { assetId: asset.assetId, price };
        }),
      );
      batchResults.forEach(({ assetId, price }) => {
        priceMap.set(assetId, price);
      });
    }

    let periodCommissionUsd = 0;
    let totalSwapVolumeUsd = 0;
    const swapCount = periodSwaps.length;

    for (const swap of periodSwaps) {
      const { feeUsd, volumeUsd } = await this.calculateFeeForSwap(
        swap,
        priceMap,
        freezeCutoff,
        calculateUsdValue,
      );
      totalSwapVolumeUsd += volumeUsd;
      periodCommissionUsd += feeUsd;
    }

    let allTimeCommissionUsd = 0;
    for (const swap of allTimeSwaps) {
      const { feeUsd } = await this.calculateFeeForSwap(
        swap,
        priceMap,
        freezeCutoff,
        calculateUsdValue,
      );
      allTimeCommissionUsd += feeUsd;
    }

    this.logger.log(
      `Affiliate fee calculation for ${affiliateAddress}: ` +
        `Period: ${swapCount} swaps, $${totalSwapVolumeUsd.toFixed(2)} volume, $${periodCommissionUsd.toFixed(2)} commission | ` +
        `All-time: ${allTimeSwaps.length} swaps, $${allTimeCommissionUsd.toFixed(2)} total commission`,
    );

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

  private static readonly API_BASE_BPS = 10;
  private static readonly WEB_REVENUE_SHARE = 0.1;

  private getAffiliateCommissionRate(
    origin: string | null,
    verifiedBps: number,
    shapeshiftBps: number,
  ): number {
    if (origin === 'web') {
      // Referrer gets shapeshiftBps of volume (shapeshiftBps / verifiedBps of the fee)
      return shapeshiftBps / verifiedBps;
    }
    if (!origin || verifiedBps <= shapeshiftBps) return 0;
    return (verifiedBps - shapeshiftBps) / verifiedBps;
  }

  private async calculateFeeForSwap(
    swap: {
      id: string;
      swapId: string;
      swapperName: string;
      sellAsset: unknown;
      buyAsset: unknown;
      sellAmountCryptoBaseUnit: string;
      sellAmountCryptoPrecision: string;
      expectedBuyAmountCryptoBaseUnit: string;
      sellAmountUsd: string | null;
      affiliateBps: string | number | null;
      origin: string | null;
      affiliateFeeAssetId: string | null;
      affiliateVerificationDetails: unknown;
      createdAt: Date;
      shapeshiftBps: number;
    },
    priceMap: Map<string, number | null>,
    freezeCutoff: Date,
    calculateUsdValue: (amount: string, price: number) => string,
  ): Promise<{ feeUsd: number; volumeUsd: number }> {
    const sellAmountUsd = await this.resolveSwapUsdValue(
      swap,
      priceMap,
      freezeCutoff,
      calculateUsdValue,
    );
    if (sellAmountUsd === null) return { feeUsd: 0, volumeUsd: 0 };

    const verificationDetails =
      swap.affiliateVerificationDetails as AffiliateVerificationDetails | null;
    const verifiedBps =
      verificationDetails?.affiliateBps ??
      (swap.affiliateBps ? parseInt(String(swap.affiliateBps)) : undefined);

    if (!verifiedBps || sellAmountUsd <= 0) {
      return { feeUsd: 0, volumeUsd: sellAmountUsd };
    }

    const commissionRate = this.getAffiliateCommissionRate(
      swap.origin,
      verifiedBps,
      swap.shapeshiftBps,
    );

    const verifiedSell = verificationDetails?.verifiedSellAmountCryptoBaseUnit;
    const effectiveSellAmount = verifiedSell
      ? bnOrZero(verifiedSell).lt(bnOrZero(swap.sellAmountCryptoBaseUnit))
        ? verifiedSell
        : swap.sellAmountCryptoBaseUnit
      : swap.sellAmountCryptoBaseUnit;

    let totalFeeUsd: number;
    const feeAssetId = swap.affiliateFeeAssetId;
    const feeAssetPrice = feeAssetId ? priceMap.get(feeAssetId) : null;

    if (feeAssetId && feeAssetPrice) {
      const sellAssetObj = swap.sellAsset as Asset;
      const buyAssetObj = swap.buyAsset as Asset;
      const feeAmountBaseUnit = this.estimateAffiliateFeeAmount(
        verifiedBps,
        swap.swapperName,
        effectiveSellAmount,
        swap.expectedBuyAmountCryptoBaseUnit,
      );
      const feeAssetPrecision =
        feeAssetId === sellAssetObj.assetId
          ? sellAssetObj.precision
          : buyAssetObj.precision;
      const feeAmountHuman = bnOrZero(feeAmountBaseUnit)
        .div(bnOrZero(10).pow(feeAssetPrecision))
        .toNumber();
      totalFeeUsd = feeAmountHuman * feeAssetPrice;
    } else {
      totalFeeUsd = (sellAmountUsd * verifiedBps) / 10000;
    }

    return { feeUsd: totalFeeUsd * commissionRate, volumeUsd: sellAmountUsd };
  }

  private estimateAffiliateFeeAmount(
    affiliateBps: number,
    swapperName: string,
    sellAmountCryptoBaseUnit: string,
    expectedBuyAmountCryptoBaseUnit: string,
  ): string {
    const strategy = getSwapperFeeStrategy(swapperName);
    const bpsMultiplier = affiliateBps / 10000;

    switch (strategy) {
      case 'sell_asset':
        return bnOrZero(sellAmountCryptoBaseUnit)
          .times(bpsMultiplier)
          .toFixed(0);
      case 'buy_asset':
        return bnOrZero(expectedBuyAmountCryptoBaseUnit)
          .times(bpsMultiplier)
          .toFixed(0);
      case 'fixed_base':
      default:
        return bnOrZero(sellAmountCryptoBaseUnit)
          .times(bpsMultiplier)
          .toFixed(0);
    }
  }

  async pollSwapStatus(swapId: string): Promise<SwapStatusResponse> {
    try {
      this.logger.log(`Polling status for swap: ${swapId}`);

      const swap = await this.prisma.swap.findUnique({
        where: { swapId },
      });

      if (!swap) {
        throw new Error(`Swap not found: ${swapId}`);
      }

      const sellAsset = swap.sellAsset as Asset;

      const swapper = swappers[swap.swapperName as SwapperName];

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
        } as unknown as SwapperSwap,
        stepIndex: 0,
        config: {
          VITE_UNCHAINED_THORCHAIN_HTTP_URL:
            process.env.VITE_UNCHAINED_THORCHAIN_HTTP_URL || '',
          VITE_UNCHAINED_MAYACHAIN_HTTP_URL:
            process.env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL || '',
          VITE_UNCHAINED_COSMOS_HTTP_URL:
            process.env.VITE_UNCHAINED_COSMOS_HTTP_URL || '',
          VITE_THORCHAIN_NODE_URL: process.env.VITE_THORCHAIN_NODE_URL || '',
          VITE_MAYACHAIN_NODE_URL: process.env.VITE_MAYACHAIN_NODE_URL || '',
          VITE_COWSWAP_BASE_URL: process.env.VITE_COWSWAP_BASE_URL || '',
          VITE_CHAINFLIP_API_KEY: process.env.VITE_CHAINFLIP_API_KEY || '',
          VITE_CHAINFLIP_API_URL: process.env.VITE_CHAINFLIP_API_URL || '',
          VITE_RELAY_API_URL: process.env.VITE_RELAY_API_URL || '',
          VITE_PORTALS_BASE_URL: process.env.VITE_PORTALS_BASE_URL || '',
          VITE_ZRX_BASE_URL: process.env.VITE_ZRX_BASE_URL || '',
          VITE_THORCHAIN_MIDGARD_URL:
            process.env.VITE_THORCHAIN_MIDGARD_URL || '',
          VITE_MAYACHAIN_MIDGARD_URL:
            process.env.VITE_MAYACHAIN_MIDGARD_URL || '',
          VITE_UNCHAINED_BITCOIN_HTTP_URL:
            process.env.VITE_UNCHAINED_BITCOIN_HTTP_URL || '',
          VITE_UNCHAINED_DOGECOIN_HTTP_URL:
            process.env.VITE_UNCHAINED_DOGECOIN_HTTP_URL || '',
          VITE_UNCHAINED_LITECOIN_HTTP_URL:
            process.env.VITE_UNCHAINED_LITECOIN_HTTP_URL || '',
          VITE_UNCHAINED_BITCOINCASH_HTTP_URL:
            process.env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL || '',
          VITE_UNCHAINED_ETHEREUM_HTTP_URL:
            process.env.VITE_UNCHAINED_ETHEREUM_HTTP_URL || '',
          VITE_UNCHAINED_AVALANCHE_HTTP_URL:
            process.env.VITE_UNCHAINED_AVALANCHE_HTTP_URL || '',
          VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL:
            process.env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL || '',
          VITE_UNCHAINED_BASE_HTTP_URL:
            process.env.VITE_UNCHAINED_BASE_HTTP_URL || '',
          VITE_NEAR_INTENTS_API_KEY:
            process.env.VITE_NEAR_INTENTS_API_KEY || '',
          VITE_BEBOP_API_KEY: process.env.VITE_BEBOP_API_KEY || '',
          VITE_TENDERLY_API_KEY: process.env.VITE_TENDERLY_API_KEY || '',
          VITE_TENDERLY_ACCOUNT_SLUG:
            process.env.VITE_TENDERLY_ACCOUNT_SLUG || '',
          VITE_TENDERLY_PROJECT_SLUG:
            process.env.VITE_TENDERLY_PROJECT_SLUG || '',
          VITE_TRON_NODE_URL: process.env.VITE_TRON_NODE_URL || '',
          VITE_SUI_NODE_URL: process.env.VITE_SUI_NODE_URL || '',
          VITE_ACROSS_API_URL: process.env.VITE_ACROSS_API_URL || '',
          VITE_ACROSS_INTEGRATOR_ID:
            process.env.VITE_ACROSS_INTEGRATOR_ID || '',
          VITE_DEBRIDGE_API_URL: process.env.VITE_DEBRIDGE_API_URL || '',
          VITE_FEATURE_THORCHAINSWAP_LONGTAIL: true,
          VITE_FEATURE_THORCHAINSWAP_L1_TO_LONGTAIL: true,
          VITE_FEATURE_CHAINFLIP_SWAP_DCA: true,
        },
        assertGetSolanaChainAdapter: (chainId: ChainId) => {
          return this.solanaChainAdapterService.assertGetSolanaChainAdapter(
            chainId,
          );
        },
        assertGetUtxoChainAdapter: (chainId: ChainId) => {
          return this.utxoChainAdapterService.assertGetUtxoChainAdapter(
            chainId,
          );
        },
        assertGetCosmosSdkChainAdapter: (chainId: ChainId) => {
          return this.cosmosSdkChainAdapterService.assertGetCosmosSdkChainAdapter(
            chainId,
          );
        },
        assertGetEvmChainAdapter: (chainId: ChainId) => {
          return this.evmChainAdapterService.assertGetEvmChainAdapter(chainId);
        },
        assertGetTronChainAdapter: (chainId: ChainId) => {
          return this.tronChainAdapterService.assertGetTronChainAdapter(
            chainId,
          );
        },
        assertGetSuiChainAdapter: (chainId: ChainId) => {
          return this.suiChainAdapterService.assertGetSuiChainAdapter(chainId);
        },
        assertGetNearChainAdapter: (chainId: ChainId) => {
          return this.nearChainAdapterService.assertGetNearChainAdapter(
            chainId,
          );
        },
        assertGetStarknetChainAdapter: (chainId: ChainId) => {
          return this.starknetChainAdapterService.assertGetStarknetChainAdapter(
            chainId,
          );
        },
        assertGetTonChainAdapter: (chainId: ChainId) => {
          return this.tonChainAdapterService.assertGetTonChainAdapter(chainId);
        },
        fetchIsSmartContractAddressQuery: () => Promise.resolve(false),
      });

      // Verify affiliate usage
      let isAffiliateVerified: boolean | undefined;
      let affiliateVerificationDetails:
        | {
            hasAffiliate: boolean;
            affiliateBps?: number;
            affiliateAddress?: string;
            verifiedSellAmountCryptoBaseUnit?: string;
          }
        | undefined;

      try {
        // Enrich metadata with swap fields needed for verification
        const enrichedMetadata = {
          ...(swap.metadata as Record<string, any>),
          receiveAddress: swap.receiveAddress,
          expectedBuyAmountCryptoPrecision:
            swap.expectedBuyAmountCryptoPrecision,
          createdAt: swap.createdAt.getTime(),
          sellAssetPrecision: sellAsset.precision,
          affiliateBps: swap.affiliateBps,
          affiliateAddress: swap.affiliateAddress,
          integratorFeeRecipient: swap.affiliateAddress,
          sellAmountCryptoBaseUnit: swap.sellAmountCryptoBaseUnit,
        };

        const verificationResult =
          await this.swapVerificationService.verifySwapAffiliate(
            swapId,
            swap.swapperName,
            sellAsset.chainId,
            swap.sellTxHash || undefined,
            enrichedMetadata,
          );

        isAffiliateVerified =
          verificationResult.isVerified && verificationResult.hasAffiliate;

        if (verificationResult.isVerified) {
          affiliateVerificationDetails = {
            hasAffiliate: verificationResult.hasAffiliate,
            affiliateBps: verificationResult.affiliateBps,
            affiliateAddress: verificationResult.affiliateAddress,
            verifiedSellAmountCryptoBaseUnit:
              verificationResult.verifiedSellAmountCryptoBaseUnit,
          };
        }

        this.logger.log(
          `Affiliate verification for swap ${swapId}: verified=${verificationResult.isVerified}, hasAffiliate=${verificationResult.hasAffiliate}`,
        );

        // Update the database with verification result
        await this.prisma.swap.update({
          where: { swapId },
          data: {
            isAffiliateVerified,
            affiliateVerificationDetails: affiliateVerificationDetails || {},
            affiliateVerifiedAt: new Date(),
          },
        });
      } catch (verificationError) {
        this.logger.warn(
          `Failed to verify affiliate for swap ${swapId}:`,
          verificationError,
        );
        // Don't fail the entire status check if verification fails
      }

      return {
        status:
          status.status === TxStatus.Confirmed
            ? 'SUCCESS'
            : status.status === TxStatus.Failed
              ? 'FAILED'
              : 'PENDING',
        sellTxHash: swap.sellTxHash,
        buyTxHash: status.buyTxHash,
        statusMessage:
          typeof status.message === 'string'
            ? status.message
            : Array.isArray(status.message)
              ? status.message[0]
              : '',
        isAffiliateVerified,
        affiliateVerificationDetails,
      };
    } catch (error) {
      this.logger.error(`Failed to poll swap status for ${swapId}:`, error);
      return {
        status: 'PENDING',
        statusMessage: `Error polling status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async findSwapBySwapId(swapId: string) {
    return this.prisma.swap.findUnique({
      where: { swapId },
    });
  }

  async cleanupTestSwaps() {
    const result = await this.prisma.swap.updateMany({
      where: {
        swapId: { startsWith: 'test-' },
        status: { in: ['IDLE', 'PENDING'] },
      },
      data: {
        status: 'FAILED',
        statusMessage: 'Cleaned up by test runner',
      },
    });
    return { cleaned: result.count };
  }
}
