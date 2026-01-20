import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PathfinderService, FoundPath } from './pathfinder.service';
import { RouteGraphService, RouteEdgeData } from './route-graph.service';
import { RouteCacheService } from './route-cache.service';
import {
  MultiStepQuoteRequest,
  MultiStepQuoteResponse,
  MultiStepRoute,
  RouteStep,
  RouteConstraints,
} from '@shapeshift/shared-types';
import { SwapperName } from '@shapeshiftoss/swapper';
import { Asset } from '@shapeshiftoss/types';
import { getAssetPriceUsd, calculateUsdValue } from '../utils/pricing';

/**
 * Result of fetching a quote for a single step
 */
export interface StepQuoteResult {
  success: boolean;
  sellAmountCryptoBaseUnit: string;
  expectedBuyAmountCryptoBaseUnit: string;
  feeUsd: string;
  slippagePercent: string;
  estimatedTimeSeconds: number;
  error?: string;
}

/**
 * Configuration for quote generation
 */
interface QuoteConfig {
  /** Quote expiry time in milliseconds (default: 30000) */
  quoteExpiryMs: number;
  /** Price impact warning threshold percent (default: 2) */
  priceImpactWarningPercent: number;
  /** Price impact flag threshold percent (default: 5) */
  priceImpactFlagPercent: number;
}

/**
 * Default quote configuration
 */
const DEFAULT_QUOTE_CONFIG: QuoteConfig = {
  quoteExpiryMs: 30_000, // 30 seconds
  priceImpactWarningPercent: 2,
  priceImpactFlagPercent: 5, // Flag routes with >5% price impact
};

/**
 * QuoteAggregatorService - Aggregates quotes across multi-hop paths from different swappers.
 *
 * This service:
 * - Generates multi-step quotes by chaining individual swapper quotes
 * - Calculates total fees, slippage, and estimated time across all hops
 * - Handles price impact calculation and flagging
 * - Manages quote expiration with configurable TTL
 *
 * Quote aggregation flow:
 * 1. Find path using PathfinderService
 * 2. For each hop, fetch quote from the appropriate swapper
 * 3. Chain quotes: output of step N becomes input of step N+1
 * 4. Aggregate totals (fees, slippage, time) and return combined quote
 */
@Injectable()
export class QuoteAggregatorService {
  private readonly logger = new Logger(QuoteAggregatorService.name);
  private readonly quoteConfig: QuoteConfig;

  constructor(
    private readonly pathfinderService: PathfinderService,
    private readonly routeGraphService: RouteGraphService,
    private readonly cacheService: RouteCacheService,
    private readonly httpService: HttpService,
  ) {
    this.quoteConfig = DEFAULT_QUOTE_CONFIG;
    this.logger.log('QuoteAggregatorService initialized');
  }

  /**
   * Generate a multi-step quote for swapping between two assets.
   *
   * This is the main entry point for multi-step quote generation.
   * It finds a path, fetches quotes for each hop, and aggregates the results.
   *
   * @param request The multi-step quote request parameters
   * @returns MultiStepQuoteResponse with route details or error
   */
  async getMultiStepQuote(
    request: MultiStepQuoteRequest,
  ): Promise<MultiStepQuoteResponse> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Generating multi-step quote: ${request.sellAssetId} -> ${request.buyAssetId} (amount: ${request.sellAmountCryptoBaseUnit})`,
      );

      // Build constraints from request
      const constraints: Partial<RouteConstraints> = {
        maxHops: request.maxHops,
        maxCrossChainHops: request.maxCrossChainHops,
      };

      // Find path using pathfinder
      const pathResult = await this.pathfinderService.findPath(
        request.sellAssetId,
        request.buyAssetId,
        constraints,
      );

      if (!pathResult.success || !pathResult.path) {
        this.logger.warn(
          `No route found: ${request.sellAssetId} -> ${request.buyAssetId} - ${pathResult.error}`,
        );
        return {
          success: false,
          route: null,
          expiresAt: this.calculateExpiryTime(),
          error: pathResult.error || 'No route available',
        };
      }

      // Aggregate quotes for the found path
      const route = await this.aggregateMultiStepQuote(
        pathResult.path,
        request.sellAmountCryptoBaseUnit,
        request.userAddress,
        request.receiveAddress,
      );

      if (!route) {
        return {
          success: false,
          route: null,
          expiresAt: this.calculateExpiryTime(),
          error: 'Failed to generate quotes for route',
        };
      }

      // Find alternative routes if requested
      let alternativeRoutes: MultiStepRoute[] | undefined;
      const maxAlternatives = this.cacheService.getConfig().maxAlternativeRoutes || 3;

      if (maxAlternatives > 0) {
        try {
          const altPaths = await this.pathfinderService.findAlternativeRoutes(
            request.sellAssetId,
            request.buyAssetId,
            constraints,
            maxAlternatives,
          );

          if (altPaths.length > 0) {
            alternativeRoutes = [];
            for (const altPath of altPaths) {
              const altRoute = await this.aggregateMultiStepQuote(
                altPath,
                request.sellAmountCryptoBaseUnit,
                request.userAddress,
                request.receiveAddress,
              );
              if (altRoute) {
                alternativeRoutes.push(altRoute);
              }
            }
          }
        } catch (altError) {
          this.logger.warn('Failed to find alternative routes', altError);
          // Continue without alternatives
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Multi-step quote generated in ${duration}ms: ${route.totalSteps} steps, estimated output: ${route.estimatedOutputCryptoPrecision}`,
      );

      return {
        success: true,
        route,
        alternativeRoutes: alternativeRoutes?.length ? alternativeRoutes : undefined,
        expiresAt: this.calculateExpiryTime(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate multi-step quote: ${request.sellAssetId} -> ${request.buyAssetId}`,
        error,
      );
      return {
        success: false,
        route: null,
        expiresAt: this.calculateExpiryTime(),
        error: error instanceof Error ? error.message : 'Unknown error generating quote',
      };
    }
  }

  /**
   * Fetch a quote for a single step in the multi-step route.
   *
   * This method queries the appropriate swapper for a quote based on the edge data.
   * Each swapper has a specific API for getting quotes which is called directly.
   *
   * @param edge The route edge data for this step
   * @param sellAmountCryptoBaseUnit The amount to sell in base units
   * @param userAddress The user's address
   * @param receiveAddress The address to receive the output
   * @returns StepQuoteResult with quote details or error
   */
  async getQuoteForStep(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
    receiveAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      this.logger.debug(
        `Fetching quote for step: ${edge.sellAssetId} -> ${edge.buyAssetId} via ${edge.swapperName}`,
      );

      // Route to the appropriate swapper quote method
      switch (edge.swapperName) {
        case SwapperName.Thorchain:
          return await this.getThorchainQuote(edge, sellAmountCryptoBaseUnit, receiveAddress);
        case SwapperName.Mayachain:
          return await this.getMayachainQuote(edge, sellAmountCryptoBaseUnit, receiveAddress);
        case SwapperName.Chainflip:
          return await this.getChainflipQuote(edge, sellAmountCryptoBaseUnit, receiveAddress);
        case SwapperName.CowSwap:
          return await this.getCowSwapQuote(edge, sellAmountCryptoBaseUnit, userAddress);
        case SwapperName.Zrx:
          return await this.getZrxQuote(edge, sellAmountCryptoBaseUnit, userAddress);
        case SwapperName.Relay:
          return await this.getRelayQuote(edge, sellAmountCryptoBaseUnit, userAddress, receiveAddress);
        case SwapperName.Portals:
          return await this.getPortalsQuote(edge, sellAmountCryptoBaseUnit, userAddress);
        case SwapperName.Jupiter:
          return await this.getJupiterQuote(edge, sellAmountCryptoBaseUnit, userAddress);
        default:
          this.logger.warn(`Unsupported swapper: ${edge.swapperName}`);
          return {
            success: false,
            sellAmountCryptoBaseUnit,
            expectedBuyAmountCryptoBaseUnit: '0',
            feeUsd: '0',
            slippagePercent: '0',
            estimatedTimeSeconds: 0,
            error: `Unsupported swapper: ${edge.swapperName}`,
          };
      }
    } catch (error) {
      this.logger.error(
        `Failed to get quote for step: ${edge.sellAssetId} -> ${edge.buyAssetId}`,
        error,
      );
      return {
        success: false,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: '0',
        feeUsd: '0',
        slippagePercent: '0',
        estimatedTimeSeconds: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get quote from Thorchain via Midgard API
   */
  private async getThorchainQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    receiveAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const midgardUrl = process.env.VITE_THORCHAIN_MIDGARD_URL || 'https://midgard.thorchain.info';
      const thorNodeUrl = process.env.VITE_THORCHAIN_NODE_URL || 'https://thornode.ninerealms.com';

      // Convert asset IDs to Thorchain format
      const fromAsset = this.assetIdToThorchainAsset(edge.sellAssetId);
      const toAsset = this.assetIdToThorchainAsset(edge.buyAssetId);

      if (!fromAsset || !toAsset) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to convert asset IDs to Thorchain format');
      }

      // Query Thornode quote endpoint
      const quoteUrl = `${thorNodeUrl}/thorchain/quote/swap`;
      const params = new URLSearchParams({
        from_asset: fromAsset,
        to_asset: toAsset,
        amount: sellAmountCryptoBaseUnit,
        destination: receiveAddress,
      });

      this.logger.debug(`Fetching Thorchain quote: ${quoteUrl}?${params.toString()}`);

      const response = await firstValueFrom(
        this.httpService.get(`${quoteUrl}?${params.toString()}`, { timeout: 10000 }),
      );

      const quote = response.data;

      // Extract quote data from Thorchain response
      const expectedOutput = quote.expected_amount_out || '0';
      const fees = quote.fees || {};
      const totalFeeUsd = this.calculateThorchainFeesUsd(fees);
      const slippageBps = quote.slippage_bps || 0;
      const slippagePercent = (slippageBps / 100).toFixed(2);

      // Thorchain swaps typically take 10-30 minutes for cross-chain
      const estimatedTimeSeconds = edge.isCrossChain ? 1200 : 60;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: totalFeeUsd.toFixed(2),
        slippagePercent,
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('Thorchain quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'Thorchain quote failed',
      );
    }
  }

  /**
   * Get quote from Mayachain via their API
   */
  private async getMayachainQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    receiveAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const mayaNodeUrl = process.env.VITE_MAYACHAIN_NODE_URL || 'https://mayanode.mayachain.info';

      // Convert asset IDs to Mayachain format (similar to Thorchain)
      const fromAsset = this.assetIdToMayachainAsset(edge.sellAssetId);
      const toAsset = this.assetIdToMayachainAsset(edge.buyAssetId);

      if (!fromAsset || !toAsset) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to convert asset IDs to Mayachain format');
      }

      const quoteUrl = `${mayaNodeUrl}/mayachain/quote/swap`;
      const params = new URLSearchParams({
        from_asset: fromAsset,
        to_asset: toAsset,
        amount: sellAmountCryptoBaseUnit,
        destination: receiveAddress,
      });

      this.logger.debug(`Fetching Mayachain quote: ${quoteUrl}?${params.toString()}`);

      const response = await firstValueFrom(
        this.httpService.get(`${quoteUrl}?${params.toString()}`, { timeout: 10000 }),
      );

      const quote = response.data;
      const expectedOutput = quote.expected_amount_out || '0';
      const slippageBps = quote.slippage_bps || 0;
      const slippagePercent = (slippageBps / 100).toFixed(2);

      // Mayachain swaps are similar to Thorchain
      const estimatedTimeSeconds = edge.isCrossChain ? 1200 : 60;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: '0', // Mayachain fees are included in the output
        slippagePercent,
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('Mayachain quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'Mayachain quote failed',
      );
    }
  }

  /**
   * Get quote from Chainflip via their API
   */
  private async getChainflipQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    receiveAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const chainflipApiUrl = process.env.VITE_CHAINFLIP_API_URL || 'https://chainflip-broker.io';

      // Convert asset IDs to Chainflip format
      const srcAsset = this.assetIdToChainflipAsset(edge.sellAssetId);
      const destAsset = this.assetIdToChainflipAsset(edge.buyAssetId);

      if (!srcAsset || !destAsset) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to convert asset IDs to Chainflip format');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const apiKey = process.env.VITE_CHAINFLIP_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const quoteUrl = `${chainflipApiUrl}/quote`;
      const quoteRequest = {
        srcAsset: srcAsset.asset,
        srcChain: srcAsset.chain,
        destAsset: destAsset.asset,
        destChain: destAsset.chain,
        amount: sellAmountCryptoBaseUnit,
      };

      this.logger.debug(`Fetching Chainflip quote: ${quoteUrl}`, quoteRequest);

      const response = await firstValueFrom(
        this.httpService.post(quoteUrl, quoteRequest, { headers, timeout: 10000 }),
      );

      const quote = response.data;
      const expectedOutput = quote.egressAmount || quote.estimatedOutput || '0';

      // Chainflip cross-chain swaps typically complete in 5-15 minutes
      const estimatedTimeSeconds = 600;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: (quote.estimatedFeesUsd || 0).toFixed(2),
        slippagePercent: (quote.slippagePercent || 0.5).toFixed(2),
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('Chainflip quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'Chainflip quote failed',
      );
    }
  }

  /**
   * Get quote from CowSwap via their API
   */
  private async getCowSwapQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const cowSwapBaseUrl = process.env.VITE_COWSWAP_BASE_URL || 'https://api.cow.fi';

      // Extract token addresses from asset IDs
      const sellToken = this.extractTokenAddress(edge.sellAssetId);
      const buyToken = this.extractTokenAddress(edge.buyAssetId);
      const chainId = this.extractChainIdNumber(edge.sellChainId);

      if (!sellToken || !buyToken || !chainId) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to extract token addresses');
      }

      const network = this.chainIdToNetwork(chainId);
      const quoteUrl = `${cowSwapBaseUrl}/${network}/api/v1/quote`;

      const quoteRequest = {
        sellToken,
        buyToken,
        sellAmountBeforeFee: sellAmountCryptoBaseUnit,
        from: userAddress,
        kind: 'sell',
        receiver: userAddress,
        validTo: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
        appData: '0x0000000000000000000000000000000000000000000000000000000000000000',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
      };

      this.logger.debug(`Fetching CowSwap quote: ${quoteUrl}`, quoteRequest);

      const response = await firstValueFrom(
        this.httpService.post(quoteUrl, quoteRequest, { timeout: 15000 }),
      );

      const quote = response.data.quote || response.data;
      const expectedOutput = quote.buyAmount || '0';
      const feeAmount = quote.feeAmount || '0';

      // CowSwap EVM swaps are typically fast
      const estimatedTimeSeconds = 120;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: '0', // CowSwap fees are in tokens, not USD
        slippagePercent: '0.5', // Default slippage
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('CowSwap quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'CowSwap quote failed',
      );
    }
  }

  /**
   * Get quote from 0x/ZRX via their API
   */
  private async getZrxQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const zrxBaseUrl = process.env.VITE_ZRX_BASE_URL || 'https://api.0x.org';

      const sellToken = this.extractTokenAddress(edge.sellAssetId);
      const buyToken = this.extractTokenAddress(edge.buyAssetId);
      const chainId = this.extractChainIdNumber(edge.sellChainId);

      if (!sellToken || !buyToken || !chainId) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to extract token addresses');
      }

      const params = new URLSearchParams({
        sellToken,
        buyToken,
        sellAmount: sellAmountCryptoBaseUnit,
        takerAddress: userAddress,
      });

      const quoteUrl = `${zrxBaseUrl}/swap/v1/quote?${params.toString()}`;

      this.logger.debug(`Fetching 0x quote: ${quoteUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(quoteUrl, { timeout: 10000 }),
      );

      const quote = response.data;
      const expectedOutput = quote.buyAmount || '0';
      const estimatedGas = quote.estimatedGas || 0;

      // 0x EVM swaps are fast
      const estimatedTimeSeconds = 60;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: (quote.estimatedPriceImpact || 0).toFixed(2),
        slippagePercent: '0.5',
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('0x quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : '0x quote failed',
      );
    }
  }

  /**
   * Get quote from Relay bridge
   */
  private async getRelayQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
    receiveAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const relayApiUrl = process.env.VITE_RELAY_API_URL || 'https://api.relay.link';

      const srcChainId = this.extractChainIdNumber(edge.sellChainId);
      const destChainId = this.extractChainIdNumber(edge.buyChainId);

      if (!srcChainId || !destChainId) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to extract chain IDs');
      }

      const quoteRequest = {
        user: userAddress,
        originChainId: srcChainId,
        destinationChainId: destChainId,
        originCurrency: this.extractTokenAddress(edge.sellAssetId) || '0x0000000000000000000000000000000000000000',
        destinationCurrency: this.extractTokenAddress(edge.buyAssetId) || '0x0000000000000000000000000000000000000000',
        amount: sellAmountCryptoBaseUnit,
        recipient: receiveAddress,
      };

      const quoteUrl = `${relayApiUrl}/quote`;

      this.logger.debug(`Fetching Relay quote: ${quoteUrl}`, quoteRequest);

      const response = await firstValueFrom(
        this.httpService.post(quoteUrl, quoteRequest, { timeout: 10000 }),
      );

      const quote = response.data;
      const expectedOutput = quote.details?.currencyOut?.amount || sellAmountCryptoBaseUnit;

      // Cross-chain bridges typically take 5-15 minutes
      const estimatedTimeSeconds = 600;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: (quote.fees?.relayer?.usd || 0).toFixed(2),
        slippagePercent: '0.1', // Bridges have minimal slippage
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('Relay quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'Relay quote failed',
      );
    }
  }

  /**
   * Get quote from Portals aggregator
   */
  private async getPortalsQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const portalsBaseUrl = process.env.VITE_PORTALS_BASE_URL || 'https://api.portals.fi';

      const sellToken = this.extractTokenAddress(edge.sellAssetId);
      const buyToken = this.extractTokenAddress(edge.buyAssetId);
      const chainId = this.extractChainIdNumber(edge.sellChainId);

      if (!sellToken || !buyToken || !chainId) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to extract token addresses');
      }

      const params = new URLSearchParams({
        inputToken: `${chainId}:${sellToken}`,
        outputToken: `${chainId}:${buyToken}`,
        inputAmount: sellAmountCryptoBaseUnit,
        slippageTolerancePercentage: '0.5',
      });

      const quoteUrl = `${portalsBaseUrl}/v2/portal?${params.toString()}`;

      this.logger.debug(`Fetching Portals quote: ${quoteUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(quoteUrl, { timeout: 10000 }),
      );

      const quote = response.data;
      const expectedOutput = quote.outputAmount || '0';

      // Portals swaps are typically fast
      const estimatedTimeSeconds = 60;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: '0',
        slippagePercent: '0.5',
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('Portals quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'Portals quote failed',
      );
    }
  }

  /**
   * Get quote from Jupiter (Solana DEX aggregator)
   */
  private async getJupiterQuote(
    edge: RouteEdgeData,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
  ): Promise<StepQuoteResult> {
    try {
      const jupiterApiUrl = process.env.VITE_JUPITER_API_URL || 'https://quote-api.jup.ag';

      // Extract Solana token mints from asset IDs
      const inputMint = this.extractSolanaMint(edge.sellAssetId);
      const outputMint = this.extractSolanaMint(edge.buyAssetId);

      if (!inputMint || !outputMint) {
        return this.createErrorResult(sellAmountCryptoBaseUnit, 'Unable to extract Solana token mints');
      }

      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: sellAmountCryptoBaseUnit,
        slippageBps: '50', // 0.5%
      });

      const quoteUrl = `${jupiterApiUrl}/v6/quote?${params.toString()}`;

      this.logger.debug(`Fetching Jupiter quote: ${quoteUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(quoteUrl, { timeout: 10000 }),
      );

      const quote = response.data;
      const expectedOutput = quote.outAmount || '0';
      const slippageBps = quote.slippageBps || 50;

      // Solana swaps are very fast
      const estimatedTimeSeconds = 30;

      return {
        success: true,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: expectedOutput.toString(),
        feeUsd: '0',
        slippagePercent: (slippageBps / 100).toFixed(2),
        estimatedTimeSeconds,
      };
    } catch (error) {
      this.logger.error('Jupiter quote failed', error);
      return this.createErrorResult(
        sellAmountCryptoBaseUnit,
        error instanceof Error ? error.message : 'Jupiter quote failed',
      );
    }
  }

  // =============== Helper Methods ===============

  /**
   * Create an error result with the given message
   */
  private createErrorResult(sellAmountCryptoBaseUnit: string, error: string): StepQuoteResult {
    return {
      success: false,
      sellAmountCryptoBaseUnit,
      expectedBuyAmountCryptoBaseUnit: '0',
      feeUsd: '0',
      slippagePercent: '0',
      estimatedTimeSeconds: 0,
      error,
    };
  }

  /**
   * Convert CAIP asset ID to Thorchain asset format
   * e.g., "eip155:1/slip44:60" -> "ETH.ETH"
   */
  private assetIdToThorchainAsset(assetId: string): string | null {
    const assetMappings: Record<string, string> = {
      'bip122:000000000019d6689c085ae165831e93/slip44:0': 'BTC.BTC',
      'eip155:1/slip44:60': 'ETH.ETH',
      'bip122:12a765e31ffd4059bada1e25190f6e98/slip44:2': 'LTC.LTC',
      'bip122:000000000000000000651ef99cb9fcbe/slip44:145': 'BCH.BCH',
      'bip122:1a91e3dace36e2be3bf030a65679fe82/slip44:3': 'DOGE.DOGE',
      'cosmos:cosmoshub-4/slip44:118': 'GAIA.ATOM',
      'eip155:43114/slip44:60': 'AVAX.AVAX',
      'eip155:56/slip44:60': 'BSC.BNB',
      'cosmos:thorchain-mainnet-v1/slip44:931': 'THOR.RUNE',
    };

    if (assetMappings[assetId]) {
      return assetMappings[assetId];
    }

    // Handle ERC20 tokens
    if (assetId.includes('/erc20:')) {
      const parts = assetId.split('/erc20:');
      const chainPart = parts[0];
      const contractAddress = parts[1].toUpperCase();

      if (chainPart === 'eip155:1') {
        return `ETH.${contractAddress}`;
      } else if (chainPart === 'eip155:43114') {
        return `AVAX.${contractAddress}`;
      } else if (chainPart === 'eip155:56') {
        return `BSC.${contractAddress}`;
      }
    }

    return null;
  }

  /**
   * Convert CAIP asset ID to Mayachain asset format
   */
  private assetIdToMayachainAsset(assetId: string): string | null {
    // Mayachain uses similar format to Thorchain with some differences
    const assetMappings: Record<string, string> = {
      'bip122:000000000019d6689c085ae165831e93/slip44:0': 'BTC.BTC',
      'eip155:1/slip44:60': 'ETH.ETH',
      'cosmos:mayachain-mainnet-v1/slip44:931': 'MAYA.CACAO',
    };

    if (assetMappings[assetId]) {
      return assetMappings[assetId];
    }

    // Use Thorchain conversion for other assets
    return this.assetIdToThorchainAsset(assetId);
  }

  /**
   * Convert CAIP asset ID to Chainflip asset format
   */
  private assetIdToChainflipAsset(assetId: string): { asset: string; chain: string } | null {
    const assetMappings: Record<string, { asset: string; chain: string }> = {
      'bip122:000000000019d6689c085ae165831e93/slip44:0': { asset: 'BTC', chain: 'Bitcoin' },
      'eip155:1/slip44:60': { asset: 'ETH', chain: 'Ethereum' },
      'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { asset: 'USDC', chain: 'Ethereum' },
      'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7': { asset: 'USDT', chain: 'Ethereum' },
      'polkadot:91b171bb158e2d3848fa23a9f1c25182/slip44:354': { asset: 'DOT', chain: 'Polkadot' },
    };

    return assetMappings[assetId] || null;
  }

  /**
   * Extract token address from CAIP asset ID
   * e.g., "eip155:1/erc20:0xa0b..." -> "0xa0b..."
   */
  private extractTokenAddress(assetId: string): string | null {
    // Native assets
    if (assetId.includes('/slip44:')) {
      // Native asset - return the zero address for EVM or wrapped version
      const chainPart = assetId.split('/')[0];
      if (chainPart.startsWith('eip155:')) {
        return '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // Common native ETH representation
      }
      return null;
    }

    // ERC20 tokens
    if (assetId.includes('/erc20:')) {
      const parts = assetId.split('/erc20:');
      return parts[1] || null;
    }

    return null;
  }

  /**
   * Extract chain ID number from CAIP chain ID
   * e.g., "eip155:1" -> 1
   */
  private extractChainIdNumber(chainId: string): number | null {
    if (chainId.startsWith('eip155:')) {
      const numStr = chainId.replace('eip155:', '');
      const num = parseInt(numStr, 10);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  /**
   * Convert chain ID number to CowSwap network name
   */
  private chainIdToNetwork(chainId: number): string {
    const networkMap: Record<number, string> = {
      1: 'mainnet',
      100: 'gnosis',
      42161: 'arbitrum_one',
      8453: 'base',
    };
    return networkMap[chainId] || 'mainnet';
  }

  /**
   * Extract Solana token mint from CAIP asset ID
   * e.g., "solana:5eykt.../spl:EPjFWdd5..." -> "EPjFWdd5..."
   */
  private extractSolanaMint(assetId: string): string | null {
    // Native SOL
    if (assetId.includes('/slip44:501')) {
      return 'So11111111111111111111111111111111111111112'; // Wrapped SOL
    }

    // SPL tokens
    if (assetId.includes('/spl:')) {
      const parts = assetId.split('/spl:');
      return parts[1] || null;
    }

    return null;
  }

  /**
   * Calculate total fees in USD from Thorchain fee breakdown
   */
  private calculateThorchainFeesUsd(fees: any): number {
    // Thorchain returns fees in various tokens
    // This is a simplified calculation - in production, would need price feeds
    const affiliateFee = parseFloat(fees.affiliate || '0');
    const outboundFee = parseFloat(fees.outbound || '0');
    const liquidityFee = parseFloat(fees.liquidity || '0');

    // Simple heuristic - actual implementation would use price feeds
    // Assuming fees are in base units of respective tokens
    return (affiliateFee + outboundFee + liquidityFee) / 1e8 * 0.01; // Rough USD estimate
  }

  /**
   * Aggregate quotes across all hops in a multi-step path.
   *
   * This method chains quotes together where the output of each step
   * becomes the input of the next step. The aggregation process:
   * 1. For each hop, fetch a quote from the appropriate swapper
   * 2. Chain the output amount of step N as the input for step N+1
   * 3. Accumulate fees, slippage, and time across all steps
   * 4. Return the complete multi-step route with aggregated totals
   *
   * @param path The found path with edges from PathfinderService
   * @param sellAmountCryptoBaseUnit Initial sell amount in base units
   * @param userAddress The user's address for intermediate steps
   * @param receiveAddress The final receive address for the last step
   * @returns MultiStepRoute with aggregated quote data, or null on failure
   */
  async aggregateMultiStepQuote(
    path: FoundPath,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
    receiveAddress: string,
  ): Promise<MultiStepRoute | null> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Aggregating quotes for path: ${path.assetIds.join(' -> ')} (${path.hopCount} hops)`,
      );

      // Validate input amount
      if (!sellAmountCryptoBaseUnit || sellAmountCryptoBaseUnit === '0') {
        this.logger.warn('Invalid sell amount provided for quote aggregation');
        return null;
      }

      // Validate path has edges
      if (!path.edges || path.edges.length === 0) {
        this.logger.warn('Path has no edges for quote aggregation');
        return null;
      }

      const steps: RouteStep[] = [];
      let currentSellAmount = sellAmountCryptoBaseUnit;
      let totalFeesUsd = 0;
      let totalSlippagePercent = 0;
      let totalEstimatedTimeSeconds = 0;
      const failedSteps: number[] = [];

      // Process each hop in the path sequentially
      // Sequential processing is required because each step's output becomes the next step's input
      for (let i = 0; i < path.edges.length; i++) {
        const edge = path.edges[i];
        const isLastStep = i === path.edges.length - 1;
        const stepStartTime = Date.now();

        this.logger.debug(
          `Fetching quote for step ${i + 1}/${path.edges.length}: ${edge.sellAssetId} -> ${edge.buyAssetId} via ${edge.swapperName} (amount: ${currentSellAmount})`,
        );

        // Get quote for this step
        // Intermediate steps receive to the user's address
        // Final step receives to the specified receive address
        const stepQuote = await this.getQuoteForStep(
          edge,
          currentSellAmount,
          userAddress,
          isLastStep ? receiveAddress : userAddress,
        );

        const stepDuration = Date.now() - stepStartTime;
        this.logger.debug(`Step ${i + 1} quote fetched in ${stepDuration}ms`);

        if (!stepQuote.success) {
          this.logger.warn(
            `Quote failed for step ${i + 1}: ${edge.sellAssetId} -> ${edge.buyAssetId} via ${edge.swapperName} - ${stepQuote.error}`,
          );
          failedSteps.push(i + 1);
          // Fail fast: if any step fails, the entire route is invalid
          return null;
        }

        // Validate the quote returned a non-zero output
        if (!stepQuote.expectedBuyAmountCryptoBaseUnit || stepQuote.expectedBuyAmountCryptoBaseUnit === '0') {
          this.logger.warn(
            `Step ${i + 1} returned zero output amount: ${edge.sellAssetId} -> ${edge.buyAssetId}`,
          );
          return null;
        }

        // Create asset representations for the step
        // Note: Asset precision is derived from the asset ID where available
        const sellAssetPrecision = this.getAssetPrecision(edge.sellAssetId);
        const buyAssetPrecision = this.getAssetPrecision(edge.buyAssetId);

        const sellAsset: Asset = {
          assetId: edge.sellAssetId,
          chainId: edge.sellChainId,
          name: this.getAssetSymbolFromId(edge.sellAssetId),
          symbol: this.getAssetSymbolFromId(edge.sellAssetId),
          precision: sellAssetPrecision,
        } as Asset;

        const buyAsset: Asset = {
          assetId: edge.buyAssetId,
          chainId: edge.buyChainId,
          name: this.getAssetSymbolFromId(edge.buyAssetId),
          symbol: this.getAssetSymbolFromId(edge.buyAssetId),
          precision: buyAssetPrecision,
        } as Asset;

        // Build the step data
        steps.push({
          stepIndex: i,
          swapperName: edge.swapperName,
          sellAsset,
          buyAsset,
          sellAmountCryptoBaseUnit: stepQuote.sellAmountCryptoBaseUnit,
          expectedBuyAmountCryptoBaseUnit: stepQuote.expectedBuyAmountCryptoBaseUnit,
          feeUsd: stepQuote.feeUsd,
          slippagePercent: stepQuote.slippagePercent,
          estimatedTimeSeconds: stepQuote.estimatedTimeSeconds,
        });

        // Chain: output of this step becomes input for next step
        currentSellAmount = stepQuote.expectedBuyAmountCryptoBaseUnit;

        // Aggregate totals
        // Fees are additive across steps
        totalFeesUsd += parseFloat(stepQuote.feeUsd) || 0;
        // Slippage compounds across steps (simplified: additive for now)
        totalSlippagePercent += parseFloat(stepQuote.slippagePercent) || 0;
        // Time is sequential - each step must complete before the next
        totalEstimatedTimeSeconds += stepQuote.estimatedTimeSeconds;

        this.logger.debug(
          `Step ${i + 1} complete: ${stepQuote.sellAmountCryptoBaseUnit} -> ${stepQuote.expectedBuyAmountCryptoBaseUnit} (fee: $${stepQuote.feeUsd}, slippage: ${stepQuote.slippagePercent}%)`,
        );
      }

      // Calculate final output with proper precision
      const finalOutputBaseUnit = currentSellAmount;
      const lastEdge = path.edges[path.edges.length - 1];
      const outputPrecision = this.getAssetPrecision(lastEdge.buyAssetId);
      const finalOutputPrecisionStr = this.formatPrecision(finalOutputBaseUnit, outputPrecision);

      // Build the complete multi-step route
      const route: MultiStepRoute = {
        totalSteps: steps.length,
        estimatedOutputCryptoBaseUnit: finalOutputBaseUnit,
        estimatedOutputCryptoPrecision: finalOutputPrecisionStr,
        totalFeesUsd: totalFeesUsd.toFixed(2),
        totalSlippagePercent: totalSlippagePercent.toFixed(2),
        estimatedTimeSeconds: totalEstimatedTimeSeconds,
        steps,
      };

      // Calculate price impact using USD values
      const priceImpactResult = await this.calculateRoutePriceImpact(
        steps[0].sellAsset,
        steps[steps.length - 1].buyAsset,
        sellAmountCryptoBaseUnit,
        finalOutputBaseUnit,
      );

      // Log price impact warnings and flags
      if (priceImpactResult.priceImpactPercent !== null) {
        if (this.isPriceImpactFlag(priceImpactResult.priceImpactPercent)) {
          this.logger.warn(
            `HIGH PRICE IMPACT FLAG: ${priceImpactResult.priceImpactPercent.toFixed(2)}% exceeds ${this.quoteConfig.priceImpactFlagPercent}% threshold ` +
            `for route ${path.assetIds.join(' -> ')} (input: $${priceImpactResult.inputValueUsd}, output: $${priceImpactResult.outputValueUsd})`,
          );
        } else if (this.isPriceImpactWarning(priceImpactResult.priceImpactPercent)) {
          this.logger.warn(
            `Price impact warning: ${priceImpactResult.priceImpactPercent.toFixed(2)}% exceeds ${this.quoteConfig.priceImpactWarningPercent}% threshold ` +
            `for route ${path.assetIds.join(' -> ')}`,
          );
        } else {
          this.logger.debug(
            `Price impact calculated: ${priceImpactResult.priceImpactPercent.toFixed(2)}% for route ${path.assetIds.join(' -> ')}`,
          );
        }
      }

      // Cache the aggregated quote for potential reuse
      const cacheKey = this.generateQuoteCacheKey(path, sellAmountCryptoBaseUnit);
      this.cacheService.set(cacheKey, route, this.quoteConfig.quoteExpiryMs);

      const totalDuration = Date.now() - startTime;
      const priceImpactLog = priceImpactResult.priceImpactPercent !== null
        ? `, price impact: ${priceImpactResult.priceImpactPercent.toFixed(2)}%`
        : '';
      this.logger.log(
        `Quote aggregation complete in ${totalDuration}ms: ${steps.length} steps, ` +
        `input: ${sellAmountCryptoBaseUnit}, output: ${finalOutputBaseUnit}, ` +
        `total fees: $${totalFeesUsd.toFixed(2)}, total slippage: ${totalSlippagePercent.toFixed(2)}%${priceImpactLog}`,
      );

      return route;
    } catch (error) {
      this.logger.error('Failed to aggregate multi-step quote', error);
      return null;
    }
  }

  /**
   * Generate a cache key for a quote based on path and amount.
   *
   * @param path The found path
   * @param sellAmount The sell amount in base units
   * @returns Cache key string
   */
  private generateQuoteCacheKey(path: FoundPath, sellAmount: string): string {
    // Create a unique key based on the path signature and sell amount
    const pathKey = path.assetIds.join(':');
    const swappers = path.edges.map(e => e.swapperName).join(':');
    return `quote:${pathKey}:${swappers}:${sellAmount}`;
  }

  /**
   * Get the precision (decimal places) for an asset based on its ID.
   *
   * @param assetId The CAIP asset ID
   * @returns Number of decimal places (defaults to 18 for EVM, varies by chain)
   */
  private getAssetPrecision(assetId: string): number {
    // Default precisions based on asset type/chain
    if (assetId.includes('/slip44:0')) {
      // Bitcoin and Bitcoin-like
      return 8;
    }
    if (assetId.includes('/slip44:501')) {
      // Solana
      return 9;
    }
    if (assetId.includes('/spl:')) {
      // Solana SPL tokens - typically 6 for USDC/USDT, 9 for others
      if (assetId.includes('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') ||
          assetId.includes('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')) {
        return 6; // USDC and USDT on Solana
      }
      return 9;
    }
    if (assetId.includes('/erc20:')) {
      // ERC20 tokens - check for known stablecoins with 6 decimals
      const contractAddress = assetId.split('/erc20:')[1]?.toLowerCase();
      if (contractAddress) {
        // Common 6-decimal stablecoins
        const sixDecimalTokens = [
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC (Ethereum)
          '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT (Ethereum)
          '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC (Arbitrum)
          '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT (Arbitrum)
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC (Base)
          '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC (Polygon)
          '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', // USDC (Gnosis)
        ];
        if (sixDecimalTokens.includes(contractAddress)) {
          return 6;
        }
        // WBTC has 8 decimals
        if (contractAddress === '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599') {
          return 8;
        }
      }
      return 18; // Default for most ERC20 tokens
    }
    if (assetId.includes('cosmos:')) {
      // Cosmos chains typically use 6 decimals
      return 6;
    }
    // Default to 18 for EVM native assets and unknown types
    return 18;
  }

  /**
   * Extract a human-readable symbol from a CAIP asset ID.
   *
   * @param assetId The CAIP asset ID
   * @returns Symbol string
   */
  private getAssetSymbolFromId(assetId: string): string {
    // Known asset mappings
    const knownSymbols: Record<string, string> = {
      'eip155:1/slip44:60': 'ETH',
      'eip155:42161/slip44:60': 'ETH',
      'eip155:8453/slip44:60': 'ETH',
      'eip155:10/slip44:60': 'ETH',
      'eip155:137/slip44:966': 'MATIC',
      'eip155:56/slip44:60': 'BNB',
      'eip155:43114/slip44:60': 'AVAX',
      'bip122:000000000019d6689c085ae165831e93/slip44:0': 'BTC',
      'bip122:12a765e31ffd4059bada1e25190f6e98/slip44:2': 'LTC',
      'bip122:000000000000000000651ef99cb9fcbe/slip44:145': 'BCH',
      'bip122:1a91e3dace36e2be3bf030a65679fe82/slip44:3': 'DOGE',
      'cosmos:cosmoshub-4/slip44:118': 'ATOM',
      'cosmos:thorchain-mainnet-v1/slip44:931': 'RUNE',
      'cosmos:mayachain-mainnet-v1/slip44:931': 'CACAO',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501': 'SOL',
      'polkadot:91b171bb158e2d3848fa23a9f1c25182/slip44:354': 'DOT',
    };

    if (knownSymbols[assetId]) {
      return knownSymbols[assetId];
    }

    // Known ERC20/SPL token symbols by contract address
    const knownTokenSymbols: Record<string, string> = {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
      '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC',
      '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83': 'USDC',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
      'So11111111111111111111111111111111111111112': 'WSOL',
    };

    // Try to extract contract address and look up
    if (assetId.includes('/erc20:')) {
      const contractAddress = assetId.split('/erc20:')[1]?.toLowerCase();
      if (contractAddress && knownTokenSymbols[contractAddress]) {
        return knownTokenSymbols[contractAddress];
      }
    }
    if (assetId.includes('/spl:')) {
      const mintAddress = assetId.split('/spl:')[1];
      if (mintAddress && knownTokenSymbols[mintAddress]) {
        return knownTokenSymbols[mintAddress];
      }
    }

    // Fallback: extract the last part of the asset ID
    const parts = assetId.split('/');
    const lastPart = parts[parts.length - 1] || '';
    if (lastPart.includes(':')) {
      // e.g., "erc20:0x1234..." -> use truncated address
      const value = lastPart.split(':')[1] || '';
      if (value.startsWith('0x') && value.length > 10) {
        return `${value.slice(0, 6)}...${value.slice(-4)}`;
      }
      return value.slice(0, 10);
    }
    return lastPart.slice(0, 10) || 'UNKNOWN';
  }

  /**
   * Calculate the expiry time for a quote.
   *
   * @returns ISO timestamp string for quote expiry
   */
  private calculateExpiryTime(): string {
    const expiryMs = Date.now() + this.quoteConfig.quoteExpiryMs;
    return new Date(expiryMs).toISOString();
  }

  /**
   * Format a base unit amount to precision display.
   *
   * @param baseUnitAmount Amount in base units (string)
   * @param decimals Number of decimal places
   * @returns Formatted precision string
   */
  private formatPrecision(baseUnitAmount: string, decimals: number): string {
    try {
      const bn = BigInt(baseUnitAmount);
      const divisor = BigInt(10 ** decimals);
      const integerPart = bn / divisor;
      const remainderPart = bn % divisor;

      // Format with decimal places
      const remainderStr = remainderPart.toString().padStart(decimals, '0');
      const trimmedRemainder = remainderStr.replace(/0+$/, '');

      if (trimmedRemainder === '') {
        return integerPart.toString();
      }

      return `${integerPart}.${trimmedRemainder}`;
    } catch {
      return '0';
    }
  }

  /**
   * Calculate price impact for a quote.
   *
   * @param inputValueUsd USD value of input
   * @param outputValueUsd USD value of output
   * @returns Price impact as a percentage
   */
  calculatePriceImpact(inputValueUsd: number, outputValueUsd: number): number {
    if (inputValueUsd === 0) return 0;
    return ((inputValueUsd - outputValueUsd) / inputValueUsd) * 100;
  }

  /**
   * Check if price impact exceeds warning threshold.
   *
   * @param priceImpactPercent The price impact percentage
   * @returns true if price impact exceeds warning threshold
   */
  isPriceImpactWarning(priceImpactPercent: number): boolean {
    return priceImpactPercent > this.quoteConfig.priceImpactWarningPercent;
  }

  /**
   * Check if price impact exceeds flag threshold.
   *
   * @param priceImpactPercent The price impact percentage
   * @returns true if price impact exceeds flag threshold
   */
  isPriceImpactFlag(priceImpactPercent: number): boolean {
    return priceImpactPercent > this.quoteConfig.priceImpactFlagPercent;
  }

  /**
   * Calculate the price impact for an entire multi-step route.
   *
   * This method fetches USD prices for the sell and buy assets,
   * calculates their USD values, and determines the price impact.
   * Price impact represents how much value is lost due to fees,
   * slippage, and market inefficiencies across all hops.
   *
   * @param sellAsset The asset being sold (first step input)
   * @param buyAsset The asset being bought (last step output)
   * @param sellAmountBaseUnit Amount being sold in base units
   * @param buyAmountBaseUnit Expected buy amount in base units
   * @returns RoutePriceImpactResult with calculated values
   */
  private async calculateRoutePriceImpact(
    sellAsset: Asset,
    buyAsset: Asset,
    sellAmountBaseUnit: string,
    buyAmountBaseUnit: string,
  ): Promise<{
    priceImpactPercent: number | null;
    inputValueUsd: string;
    outputValueUsd: string;
    isHighPriceImpact: boolean;
    isPriceImpactWarning: boolean;
  }> {
    try {
      // Fetch USD prices for both assets in parallel
      const [sellPriceUsd, buyPriceUsd] = await Promise.all([
        getAssetPriceUsd(sellAsset),
        getAssetPriceUsd(buyAsset),
      ]);

      // If we can't get prices for both assets, return null price impact
      if (sellPriceUsd === null || buyPriceUsd === null) {
        this.logger.debug(
          `Unable to calculate price impact: missing price data ` +
          `(sellAsset: ${sellAsset.assetId} price=${sellPriceUsd}, ` +
          `buyAsset: ${buyAsset.assetId} price=${buyPriceUsd})`,
        );
        return {
          priceImpactPercent: null,
          inputValueUsd: '0',
          outputValueUsd: '0',
          isHighPriceImpact: false,
          isPriceImpactWarning: false,
        };
      }

      // Convert base unit amounts to human-readable amounts using precision
      const sellPrecision = sellAsset.precision || 18;
      const buyPrecision = buyAsset.precision || 18;

      const sellAmountHuman = this.formatPrecision(sellAmountBaseUnit, sellPrecision);
      const buyAmountHuman = this.formatPrecision(buyAmountBaseUnit, buyPrecision);

      // Calculate USD values
      const inputValueUsd = calculateUsdValue(sellAmountHuman, sellPriceUsd);
      const outputValueUsd = calculateUsdValue(buyAmountHuman, buyPriceUsd);

      // Calculate price impact
      const inputUsdNum = parseFloat(inputValueUsd);
      const outputUsdNum = parseFloat(outputValueUsd);
      const priceImpactPercent = this.calculatePriceImpact(inputUsdNum, outputUsdNum);

      return {
        priceImpactPercent,
        inputValueUsd,
        outputValueUsd,
        isHighPriceImpact: this.isPriceImpactFlag(priceImpactPercent),
        isPriceImpactWarning: this.isPriceImpactWarning(priceImpactPercent),
      };
    } catch (error) {
      this.logger.error('Failed to calculate route price impact', error);
      return {
        priceImpactPercent: null,
        inputValueUsd: '0',
        outputValueUsd: '0',
        isHighPriceImpact: false,
        isPriceImpactWarning: false,
      };
    }
  }

  /**
   * Check if a quote has expired.
   *
   * @param expiresAt ISO timestamp string
   * @returns true if the quote has expired
   */
  isQuoteExpired(expiresAt: string): boolean {
    const expiryTime = new Date(expiresAt).getTime();
    return Date.now() > expiryTime;
  }

  /**
   * Get the current quote configuration.
   *
   * @returns Quote configuration
   */
  getQuoteConfig(): QuoteConfig {
    return { ...this.quoteConfig };
  }
}
