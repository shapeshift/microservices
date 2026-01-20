import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Swap } from '@prisma/client';
import { EvmChainAdapterService } from '../lib/chain-adapters/evm.service';
import { UtxoChainAdapterService } from '../lib/chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from '../lib/chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from '../lib/chain-adapters/solana.service';
import { SwapVerificationService } from '../verification/swap-verification.service';
import { QuoteAggregatorService } from '../routing/quote-aggregator.service';
import { SwapperName, swappers, SwapSource, SwapStatus } from '@shapeshiftoss/swapper';
import { ChainId } from '@shapeshiftoss/caip';
import { Asset } from '@shapeshiftoss/types';
import { hashAccountId } from '@shapeshift/shared-utils';
import { NotificationsServiceClient, UserServiceClient } from '@shapeshift/shared-utils';
import {
  CreateSwapDto,
  SwapStatusResponse,
  UpdateSwapStatusDto,
  MultiStepQuoteRequest,
  MultiStepQuoteResponse,
} from '@shapeshift/shared-types';
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
    private quoteAggregatorService: QuoteAggregatorService,
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

  /**
   * Generate a multi-step quote for swapping between two assets when no direct route exists.
   *
   * This method delegates to the QuoteAggregatorService which handles:
   * - Finding optimal paths between assets using the pathfinder
   * - Fetching quotes for each step from the appropriate swappers
   * - Aggregating quotes (chaining outputs as inputs for subsequent steps)
   * - Finding alternative routes for comparison
   *
   * Error handling includes:
   * - Input validation (missing/invalid asset IDs, zero amounts)
   * - No route available between asset pairs
   * - Quote generation failures
   * - Network/API errors
   *
   * @param request Multi-step quote request with sell/buy assets and amount
   * @returns MultiStepQuoteResponse with route details, alternatives, or error
   */
  async getMultiStepQuote(request: MultiStepQuoteRequest): Promise<MultiStepQuoteResponse> {
    const startTime = Date.now();
    const expiresAt = new Date(Date.now() + 30000).toISOString();

    try {
      // Input validation
      const validationError = this.validateMultiStepQuoteRequest(request);
      if (validationError) {
        this.logger.warn(
          `Multi-step quote request validation failed: ${validationError}`,
        );
        return {
          success: false,
          route: null,
          expiresAt,
          error: validationError,
        };
      }

      this.logger.log(
        `Generating multi-step quote: ${request.sellAssetId} -> ${request.buyAssetId} ` +
        `(amount: ${request.sellAmountCryptoBaseUnit})`,
      );

      const response = await this.quoteAggregatorService.getMultiStepQuote(request);

      if (response.success && response.route) {
        const duration = Date.now() - startTime;
        this.logger.log(
          `Multi-step quote generated successfully in ${duration}ms: ${response.route.totalSteps} steps, ` +
          `estimated output: ${response.route.estimatedOutputCryptoPrecision}`,
        );
      } else {
        // Handle no-route-available and other error scenarios with detailed logging
        const errorCode = this.categorizeQuoteError(response.error);
        this.logger.warn(
          `Multi-step quote failed [${errorCode}]: ${request.sellAssetId} -> ${request.buyAssetId} - ${response.error}`,
        );

        // Return response with categorized error
        return {
          success: false,
          route: null,
          expiresAt: response.expiresAt,
          error: this.formatQuoteError(errorCode, response.error, request),
        };
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Failed to generate multi-step quote after ${duration}ms: ${request.sellAssetId} -> ${request.buyAssetId}`,
        error,
      );

      // Categorize and format the error for the response
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = this.categorizeQuoteError(errorMessage);

      return {
        success: false,
        route: null,
        expiresAt,
        error: this.formatQuoteError(errorCode, errorMessage, request),
      };
    }
  }

  /**
   * Validate the multi-step quote request parameters.
   *
   * @param request The quote request to validate
   * @returns Error message if validation fails, null if valid
   */
  private validateMultiStepQuoteRequest(request: MultiStepQuoteRequest): string | null {
    // Check required fields
    if (!request.sellAssetId || request.sellAssetId.trim() === '') {
      return 'Missing required field: sellAssetId';
    }

    if (!request.buyAssetId || request.buyAssetId.trim() === '') {
      return 'Missing required field: buyAssetId';
    }

    if (!request.sellAmountCryptoBaseUnit || request.sellAmountCryptoBaseUnit.trim() === '') {
      return 'Missing required field: sellAmountCryptoBaseUnit';
    }

    // Check sell amount is valid and non-zero
    try {
      const sellAmount = BigInt(request.sellAmountCryptoBaseUnit);
      if (sellAmount <= 0n) {
        return 'Sell amount must be greater than zero';
      }
    } catch {
      return 'Invalid sell amount format: must be a valid integer string';
    }

    // Check asset IDs are not the same
    if (request.sellAssetId === request.buyAssetId) {
      return 'Sell and buy assets cannot be the same';
    }

    // Validate asset ID format (should be CAIP format)
    if (!this.isValidAssetId(request.sellAssetId)) {
      return `Invalid sell asset ID format: ${request.sellAssetId}`;
    }

    if (!this.isValidAssetId(request.buyAssetId)) {
      return `Invalid buy asset ID format: ${request.buyAssetId}`;
    }

    // Validate optional constraints
    if (request.maxHops !== undefined) {
      if (typeof request.maxHops !== 'number' || request.maxHops < 1 || request.maxHops > 10) {
        return 'maxHops must be a number between 1 and 10';
      }
    }

    if (request.maxCrossChainHops !== undefined) {
      if (typeof request.maxCrossChainHops !== 'number' || request.maxCrossChainHops < 0 || request.maxCrossChainHops > 5) {
        return 'maxCrossChainHops must be a number between 0 and 5';
      }
    }

    return null;
  }

  /**
   * Check if an asset ID follows a valid CAIP format.
   *
   * @param assetId The asset ID to validate
   * @returns true if the format is valid
   */
  private isValidAssetId(assetId: string): boolean {
    // Basic CAIP format validation
    // Examples:
    // - eip155:1/slip44:60 (ETH)
    // - eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 (USDC)
    // - bip122:000000000019d6689c085ae165831e93/slip44:0 (BTC)
    // - solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501 (SOL)
    // - cosmos:cosmoshub-4/slip44:118 (ATOM)

    // Must contain a slash separating chain and asset reference
    if (!assetId.includes('/')) {
      return false;
    }

    const parts = assetId.split('/');
    if (parts.length !== 2) {
      return false;
    }

    const [chainPart, assetPart] = parts;

    // Chain part should contain a colon (e.g., "eip155:1")
    if (!chainPart.includes(':')) {
      return false;
    }

    // Asset part should contain a colon (e.g., "slip44:60" or "erc20:0x...")
    if (!assetPart.includes(':')) {
      return false;
    }

    return true;
  }

  /**
   * Categorize quote errors into standard error codes for consistent handling.
   *
   * @param errorMessage The error message to categorize
   * @returns Error code string
   */
  private categorizeQuoteError(errorMessage: string | undefined): string {
    if (!errorMessage) {
      return 'UNKNOWN_ERROR';
    }

    const lowerError = errorMessage.toLowerCase();

    // No route available scenarios
    if (
      lowerError.includes('no route') ||
      lowerError.includes('no path') ||
      lowerError.includes('path not found') ||
      lowerError.includes('route not found') ||
      lowerError.includes('no valid path')
    ) {
      return 'NO_ROUTE_AVAILABLE';
    }

    // Constraint violations
    if (
      lowerError.includes('max hops') ||
      lowerError.includes('hop limit') ||
      lowerError.includes('cross-chain limit') ||
      lowerError.includes('constraint')
    ) {
      return 'ROUTE_CONSTRAINT_VIOLATED';
    }

    // Circular route detection
    if (lowerError.includes('circular') || lowerError.includes('loop')) {
      return 'CIRCULAR_ROUTE_DETECTED';
    }

    // Quote generation failures
    if (
      lowerError.includes('quote failed') ||
      lowerError.includes('failed to generate') ||
      lowerError.includes('failed to fetch')
    ) {
      return 'QUOTE_GENERATION_FAILED';
    }

    // Liquidity issues
    if (
      lowerError.includes('liquidity') ||
      lowerError.includes('insufficient') ||
      lowerError.includes('not enough')
    ) {
      return 'INSUFFICIENT_LIQUIDITY';
    }

    // Network/API errors
    if (
      lowerError.includes('timeout') ||
      lowerError.includes('network') ||
      lowerError.includes('api error') ||
      lowerError.includes('econnrefused')
    ) {
      return 'NETWORK_ERROR';
    }

    // Unsupported asset/chain
    if (
      lowerError.includes('unsupported') ||
      lowerError.includes('not supported') ||
      lowerError.includes('unknown asset') ||
      lowerError.includes('unknown chain')
    ) {
      return 'UNSUPPORTED_ASSET_OR_CHAIN';
    }

    // Price impact
    if (
      lowerError.includes('price impact') ||
      lowerError.includes('slippage')
    ) {
      return 'HIGH_PRICE_IMPACT';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Format a user-friendly error message based on the error code.
   *
   * @param errorCode The categorized error code
   * @param originalError The original error message
   * @param request The original request for context
   * @returns Formatted error message
   */
  private formatQuoteError(
    errorCode: string,
    originalError: string | undefined,
    request: MultiStepQuoteRequest,
  ): string {
    switch (errorCode) {
      case 'NO_ROUTE_AVAILABLE':
        return `No route available between ${request.sellAssetId} and ${request.buyAssetId}. ` +
          `No direct or multi-hop swap path could be found for this asset pair.`;

      case 'ROUTE_CONSTRAINT_VIOLATED':
        return `Route constraints could not be satisfied. ` +
          `Try increasing maxHops or maxCrossChainHops, or choose different assets. ` +
          `Current constraints: maxHops=${request.maxHops || 4}, maxCrossChainHops=${request.maxCrossChainHops || 2}`;

      case 'CIRCULAR_ROUTE_DETECTED':
        return `A circular route was detected in the path. ` +
          `The routing algorithm prevented a loop that would revisit the same asset.`;

      case 'QUOTE_GENERATION_FAILED':
        return `Failed to generate quotes for the route. ` +
          `One or more swappers could not provide a quote. ` +
          `Original error: ${originalError || 'Unknown'}`;

      case 'INSUFFICIENT_LIQUIDITY':
        return `Insufficient liquidity for this swap. ` +
          `Try a smaller amount or choose different assets with more liquidity.`;

      case 'NETWORK_ERROR':
        return `Network error while fetching quotes. ` +
          `Please try again later. Original error: ${originalError || 'Unknown'}`;

      case 'UNSUPPORTED_ASSET_OR_CHAIN':
        return `One or both assets are not supported for multi-step routing. ` +
          `Asset pair: ${request.sellAssetId} -> ${request.buyAssetId}`;

      case 'HIGH_PRICE_IMPACT':
        return `Route has high price impact. ` +
          `Consider trading a smaller amount or waiting for better market conditions.`;

      default:
        return originalError || 'An unknown error occurred while generating the quote';
    }
  }
}
