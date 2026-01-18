import { Injectable, Logger } from '@nestjs/common';
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

      // TODO: Implement actual swapper quote fetching in subtask-7-2
      // This is a placeholder that will be replaced with actual swapper integration

      return {
        success: false,
        sellAmountCryptoBaseUnit,
        expectedBuyAmountCryptoBaseUnit: '0',
        feeUsd: '0',
        slippagePercent: '0',
        estimatedTimeSeconds: 0,
        error: 'Not implemented - placeholder for subtask-7-2',
      };
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
