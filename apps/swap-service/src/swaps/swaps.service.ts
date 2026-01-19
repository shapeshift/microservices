import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Swap } from '@prisma/client';
import { EvmChainAdapterService } from '../lib/chain-adapters/evm.service';
import { UtxoChainAdapterService } from '../lib/chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from '../lib/chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from '../lib/chain-adapters/solana.service';
import { SwapVerificationService } from '../verification/swap-verification.service';
import { SwapperName, swappers, SwapSource, SwapStatus } from '@shapeshiftoss/swapper';
import { ChainId } from '@shapeshiftoss/caip';
import { Asset } from '@shapeshiftoss/types';
import { hashAccountId } from '@shapeshift/shared-utils';
import { NotificationsServiceClient, UserServiceClient } from '@shapeshift/shared-utils';
import { CreateSwapDto, SwapStatusResponse, UpdateSwapStatusDto } from '@shapeshift/shared-types';
import { bnOrZero } from '@shapeshiftoss/chain-adapters';

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
    private swapVerificationService: SwapVerificationService,
  ) {
    this.notificationsClient = new NotificationsServiceClient();
    this.userServiceClient = new UserServiceClient();
  }

  async createSwap(data: CreateSwapDto) {
    try {
      // Fetch referral code from user-service if userId is provided
      let referralCode: string | null = null;
      if (data.userId) {
        try {
          referralCode = await this.userServiceClient.getUserReferralCode(data.userId);
          if (referralCode) {
            this.logger.log(`Found referral code ${referralCode} for user ${data.userId}`);
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch referral code for user ${data.userId}:`, error);
          // Continue swap creation even if referral code fetch fails
        }
      }

      const swap = await this.prisma.swap.create({
        data: {
          swapId: data.swapId,
          sellAsset: data.sellAsset,
          buyAsset: data.buyAsset,
          sellTxHash: data.sellTxHash,
          sellAmountCryptoBaseUnit: data.sellAmountCryptoBaseUnit,
          expectedBuyAmountCryptoBaseUnit: data.expectedBuyAmountCryptoBaseUnit,
          sellAmountCryptoPrecision: data.sellAmountCryptoPrecision,
          expectedBuyAmountCryptoPrecision: data.expectedBuyAmountCryptoPrecision,
          source: data.source,
          swapperName: data.swapperName,
          sellAccountId: hashAccountId(data.sellAccountId),
          buyAccountId: data.buyAccountId ? hashAccountId(data.buyAccountId) : null,
          receiveAddress: data.receiveAddress,
          isStreaming: data.isStreaming || false,
          metadata: data.metadata || {},
          userId: data.userId,
          referralCode,
        },
      });

      this.logger.log(`Swap created: ${swap.id}${referralCode ? ` with referral code ${referralCode}` : ''}`);
      return swap;
    } catch (error) {
      this.logger.error('Failed to create swap', error);
      throw error;
    }
  }

  async updateSwapStatus(data: UpdateSwapStatusDto) {
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

  private async sendStatusUpdateNotification(swap: Pick<Swap, 'id' | 'userId' | 'status' | 'sellAsset' | 'buyAsset' | 'sellAmountCryptoPrecision' | 'actualBuyAmountCryptoPrecision' | 'expectedBuyAmountCryptoPrecision'>) {
    let title: string;
    let body: string;
    let type: 'SWAP_STATUS_UPDATE' | 'SWAP_COMPLETED' | 'SWAP_FAILED';

    const sellAsset = swap.sellAsset as Asset;
    const buyAsset = swap.buyAsset as Asset;

    switch (swap.status) {
      case 'SUCCESS':
        title = 'Swap Completed!';
        const buyAmount = this.formatAmount(swap.actualBuyAmountCryptoPrecision || swap.expectedBuyAmountCryptoPrecision);
        body = `Your swap of ${this.formatAmount(swap.sellAmountCryptoPrecision)} ${sellAsset.symbol} to ${buyAmount} ${buyAsset.symbol} is complete.`;
        type = 'SWAP_COMPLETED';
        break;
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

    return swaps.map(swap => ({
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

    return swaps.map(swap => ({
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
      },
    });

    return swaps.map(swap => ({
      ...swap,
      sellAsset: swap.sellAsset,
      buyAsset: swap.buyAsset,
    }));
  }

  async calculateReferralFees(referralCode: string, startDate?: Date, endDate?: Date) {
    this.logger.log(`Calculating referral fees for code: ${referralCode}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`);

    // Fetch swaps for the current period
    const periodWhereClause: any = {
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
    const { getAssetPriceUsd, calculateUsdValue } = await import('../utils/pricing');

    // Fetch prices for all unique assets from both period and all-time swaps
    const uniqueAssets = new Map<string, Asset>();
    for (const swap of [...periodSwaps, ...allTimeSwaps]) {
      const sellAsset = swap.sellAsset as Asset;
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
    const priceMap = new Map<string, number | null>();
    prices.forEach(({ assetId, price }) => {
      priceMap.set(assetId, price);
    });

    // Calculate period fees and volume
    for (const swap of periodSwaps) {
      const sellAsset = swap.sellAsset as Asset;
      const price = priceMap.get(sellAsset.assetId);

      if (!price) {
        this.logger.warn(`No price found for asset ${sellAsset.assetId}, skipping swap ${swap.swapId}`);
        continue;
      }

      const sellAmountUsd = parseFloat(calculateUsdValue(swap.sellAmountCryptoPrecision, price));
      totalSwapVolumeUsd += sellAmountUsd;

      // Extract affiliateBps from verification details
      const verificationDetails = swap.affiliateVerificationDetails as any;
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

      const sellAmountUsd = parseFloat(calculateUsdValue(swap.sellAmountCryptoPrecision, price));
      const verificationDetails = swap.affiliateVerificationDetails as any;
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
      `All-time: ${allTimeSwaps.length} swaps, $${allTimeReferrerCommissionUsd.toFixed(2)} total commission`
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

      const swapper = swappers[swap.swapperName];
      
      if (!swapper) {
        throw new Error(`Swapper not found: ${swap.swapperName}`);
      }

      if (!swap.sellTxHash) {
        throw new Error('Sell tx hash is required');
      }

      const status = await swapper.checkTradeStatus({
        txHash: swap.sellTxHash ?? '',
        chainId: sellAsset.chainId as ChainId,
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
        assertGetSolanaChainAdapter: (chainId: ChainId) => {
          return this.solanaChainAdapterService.assertGetSolanaChainAdapter(chainId);
        },
        assertGetUtxoChainAdapter: (chainId: ChainId) => {
          return this.utxoChainAdapterService.assertGetUtxoChainAdapter(chainId);
        },
        assertGetCosmosSdkChainAdapter: (chainId: ChainId) => {
          return this.cosmosSdkChainAdapterService.assertGetCosmosSdkChainAdapter(chainId);
        },
        assertGetEvmChainAdapter: (chainId: ChainId) => {
          return this.evmChainAdapterService.assertGetEvmChainAdapter(chainId);
        },
        fetchIsSmartContractAddressQuery: () => Promise.resolve(false),
      });

      // Verify affiliate usage
      let isAffiliateVerified: boolean | undefined;
      let affiliateVerificationDetails: { hasAffiliate: boolean; affiliateBps?: number; affiliateAddress?: string } | undefined;

      try {
        // Enrich metadata with swap fields needed for verification
        const enrichedMetadata = {
          ...(swap.metadata as Record<string, any>),
          receiveAddress: swap.receiveAddress,
          expectedBuyAmountCryptoPrecision: swap.expectedBuyAmountCryptoPrecision,
          createdAt: swap.createdAt.getTime(),
        };

        const verificationResult = await this.swapVerificationService.verifySwapAffiliate(
          swapId,
          swap.swapperName,
          sellAsset.chainId,
          swap.sellTxHash || undefined,
          enrichedMetadata,
        );

        isAffiliateVerified = verificationResult.isVerified && verificationResult.hasAffiliate;

        if (verificationResult.isVerified) {
          affiliateVerificationDetails = {
            hasAffiliate: verificationResult.hasAffiliate,
            affiliateBps: verificationResult.affiliateBps,
            affiliateAddress: verificationResult.affiliateAddress,
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
        this.logger.warn(`Failed to verify affiliate for swap ${swapId}:`, verificationError);
        // Don't fail the entire status check if verification fails
      }

      return {
        status: status.status === 'Confirmed' ? 'SUCCESS' :
                status.status === 'Failed' ? 'FAILED' : 'PENDING',
        sellTxHash: swap.sellTxHash,
        buyTxHash: status.buyTxHash,
        statusMessage: status.message,
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
}
