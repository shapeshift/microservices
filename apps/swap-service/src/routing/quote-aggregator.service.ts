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
  /** Price impact flag threshold percent (default: 10) */
  priceImpactFlagPercent: number;
}

/**
 * Default quote configuration
 */
const DEFAULT_QUOTE_CONFIG: QuoteConfig = {
  quoteExpiryMs: 30_000, // 30 seconds
  priceImpactWarningPercent: 2,
  priceImpactFlagPercent: 10,
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
   * becomes the input of the next step.
   *
   * @param path The found path with edges
   * @param sellAmountCryptoBaseUnit Initial sell amount in base units
   * @param userAddress The user's address
   * @param receiveAddress The final receive address
   * @returns MultiStepRoute with aggregated quote data, or null on failure
   */
  async aggregateMultiStepQuote(
    path: FoundPath,
    sellAmountCryptoBaseUnit: string,
    userAddress: string,
    receiveAddress: string,
  ): Promise<MultiStepRoute | null> {
    try {
      this.logger.debug(
        `Aggregating quotes for path: ${path.assetIds.join(' -> ')} (${path.hopCount} hops)`,
      );

      // TODO: Implement full quote aggregation in subtask-7-3
      // This is a placeholder structure

      const steps: RouteStep[] = [];
      let currentSellAmount = sellAmountCryptoBaseUnit;
      let totalFeesUsd = 0;
      let totalSlippagePercent = 0;
      let totalEstimatedTimeSeconds = 0;

      // Process each hop in the path
      for (let i = 0; i < path.edges.length; i++) {
        const edge = path.edges[i];
        const isLastStep = i === path.edges.length - 1;

        // Get quote for this step
        const stepQuote = await this.getQuoteForStep(
          edge,
          currentSellAmount,
          userAddress,
          isLastStep ? receiveAddress : userAddress, // Intermediate steps go to user address
        );

        if (!stepQuote.success) {
          this.logger.warn(
            `Quote failed for step ${i + 1}: ${edge.sellAssetId} -> ${edge.buyAssetId} - ${stepQuote.error}`,
          );
          return null;
        }

        // Create step data
        // TODO: Fetch actual asset data from asset service
        const sellAsset: Asset = {
          assetId: edge.sellAssetId,
          chainId: edge.sellChainId,
          name: edge.sellAssetId,
          symbol: edge.sellAssetId.split('/').pop() || '',
          precision: 18,
        } as Asset;

        const buyAsset: Asset = {
          assetId: edge.buyAssetId,
          chainId: edge.buyChainId,
          name: edge.buyAssetId,
          symbol: edge.buyAssetId.split('/').pop() || '',
          precision: 18,
        } as Asset;

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

        // Chain: output becomes input for next step
        currentSellAmount = stepQuote.expectedBuyAmountCryptoBaseUnit;

        // Aggregate totals
        totalFeesUsd += parseFloat(stepQuote.feeUsd) || 0;
        totalSlippagePercent += parseFloat(stepQuote.slippagePercent) || 0;
        totalEstimatedTimeSeconds += stepQuote.estimatedTimeSeconds;
      }

      // Calculate final output
      const finalOutputBaseUnit = currentSellAmount;
      const finalOutputPrecision = this.formatPrecision(finalOutputBaseUnit, 18);

      const route: MultiStepRoute = {
        totalSteps: steps.length,
        estimatedOutputCryptoBaseUnit: finalOutputBaseUnit,
        estimatedOutputCryptoPrecision: finalOutputPrecision,
        totalFeesUsd: totalFeesUsd.toFixed(2),
        totalSlippagePercent: totalSlippagePercent.toFixed(2),
        estimatedTimeSeconds: totalEstimatedTimeSeconds,
        steps,
      };

      return route;
    } catch (error) {
      this.logger.error('Failed to aggregate multi-step quote', error);
      return null;
    }
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
