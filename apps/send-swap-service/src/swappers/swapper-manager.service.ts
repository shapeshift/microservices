import { Injectable, Logger } from '@nestjs/common';
import {
  SwapperType,
  SwapperName,
  SwapperConfig,
  AvailableSwapper,
  SwapperQuoteRequest,
} from './swapper.types';
import {
  SWAPPER_CONFIGS,
  EXCLUDED_SWAPPERS,
  VALID_SWAPPERS,
  DIRECT_SWAPPERS,
  SERVICE_WALLET_SWAPPERS,
  isExcludedSwapper,
  isValidSwapper,
  filterValidSwappers,
  getSwapperConfig,
  getSwapperTypeFromConfig,
} from './swapper-config';

/**
 * SwapperManagerService handles swapper classification, filtering, and management.
 *
 * Key responsibilities:
 * - Classify swappers as DIRECT or SERVICE_WALLET
 * - Filter out swappers that don't support destination addresses
 * - Provide swapper configuration for quote generation
 *
 * Configuration is externalized to swapper-config.ts for easy updates.
 */
@Injectable()
export class SwapperManagerService {
  private readonly logger = new Logger(SwapperManagerService.name);

  /**
   * Get swapper type classification (DIRECT or SERVICE_WALLET)
   */
  getSwapperType(swapperName: SwapperName): SwapperType {
    const config = getSwapperConfig(swapperName);
    if (!config) {
      this.logger.warn(
        `Unknown swapper: ${swapperName}, defaulting to SERVICE_WALLET`,
      );
      return SwapperType.SERVICE_WALLET;
    }
    return config.type;
  }

  /**
   * Check if a swapper is a direct execution swapper
   */
  isDirectSwapper(swapperName: SwapperName): boolean {
    return this.getSwapperType(swapperName) === SwapperType.DIRECT;
  }

  /**
   * Check if a swapper is a service-wallet swapper
   */
  isServiceWalletSwapper(swapperName: SwapperName): boolean {
    return this.getSwapperType(swapperName) === SwapperType.SERVICE_WALLET;
  }

  /**
   * Check if a swapper supports destination addresses (required for send-swap)
   */
  supportsDestinationAddress(swapperName: SwapperName): boolean {
    const config = getSwapperConfig(swapperName);
    if (!config) {
      this.logger.warn(
        `Unknown swapper: ${swapperName}, assuming no destination address support`,
      );
      return false;
    }
    return config.supportsDestinationAddress;
  }

  /**
   * Check if a swapper is excluded (doesn't support destination addresses)
   */
  isExcludedSwapper(swapperName: SwapperName): boolean {
    return isExcludedSwapper(swapperName);
  }

  /**
   * Check if a swapper is valid for send-swap operations
   */
  isValidSwapper(swapperName: SwapperName): boolean {
    return isValidSwapper(swapperName);
  }

  /**
   * Get configuration for a specific swapper
   */
  getSwapperConfig(swapperName: SwapperName): SwapperConfig | undefined {
    return getSwapperConfig(swapperName);
  }

  /**
   * Get all valid swappers for send-swap (filters out excluded ones)
   */
  getValidSwappers(): AvailableSwapper[] {
    const validSwappers: AvailableSwapper[] = [];

    for (const [name, config] of SWAPPER_CONFIGS.entries()) {
      if (config.supportsDestinationAddress) {
        validSwappers.push({
          name,
          type: config.type,
          config,
        });
      }
    }

    this.logger.debug(
      `Found ${validSwappers.length} valid swappers for send-swap`,
    );
    return validSwappers;
  }

  /**
   * Get all direct swappers
   */
  getDirectSwappers(): AvailableSwapper[] {
    return this.getValidSwappers().filter(
      (s) => s.type === SwapperType.DIRECT,
    );
  }

  /**
   * Get all service-wallet swappers (that support destination addresses)
   */
  getServiceWalletSwappers(): AvailableSwapper[] {
    return this.getValidSwappers().filter(
      (s) => s.type === SwapperType.SERVICE_WALLET,
    );
  }

  /**
   * Get excluded swappers (for logging/debugging)
   */
  getExcludedSwappers(): SwapperConfig[] {
    const excluded: SwapperConfig[] = [];

    for (const config of SWAPPER_CONFIGS.values()) {
      if (!config.supportsDestinationAddress) {
        excluded.push(config);
      }
    }

    return excluded;
  }

  /**
   * Get list of excluded swapper names
   */
  getExcludedSwapperNames(): readonly SwapperName[] {
    return EXCLUDED_SWAPPERS;
  }

  /**
   * Get list of valid swapper names
   */
  getValidSwapperNames(): readonly SwapperName[] {
    return VALID_SWAPPERS;
  }

  /**
   * Get list of direct swapper names
   */
  getDirectSwapperNames(): readonly SwapperName[] {
    return DIRECT_SWAPPERS;
  }

  /**
   * Get list of service-wallet swapper names
   */
  getServiceWalletSwapperNames(): readonly SwapperName[] {
    return SERVICE_WALLET_SWAPPERS;
  }

  /**
   * Filter a list of swapper names to only include valid ones
   */
  filterValidSwapperNames(swapperNames: SwapperName[]): SwapperName[] {
    return filterValidSwappers(swapperNames);
  }

  /**
   * Log swapper classification summary (useful for debugging at startup)
   */
  logSwapperSummary(): void {
    const directSwappers = this.getDirectSwappers();
    const serviceWalletSwappers = this.getServiceWalletSwappers();
    const excludedSwappers = this.getExcludedSwappers();

    this.logger.log('=== Swapper Classification Summary ===');
    this.logger.log(
      `Direct swappers (${directSwappers.length}): ${directSwappers.map((s) => s.name).join(', ')}`,
    );
    this.logger.log(
      `Service-wallet swappers (${serviceWalletSwappers.length}): ${serviceWalletSwappers.map((s) => s.name).join(', ')}`,
    );
    this.logger.log(
      `Excluded swappers (${excludedSwappers.length}): ${excludedSwappers.map((s) => s.name).join(', ')}`,
    );
  }

  /**
   * Validate a quote request can be processed by the given swapper
   */
  validateSwapperForQuote(
    swapperName: SwapperName,
    _request: SwapperQuoteRequest,
  ): { valid: boolean; reason?: string } {
    const config = getSwapperConfig(swapperName);

    if (!config) {
      return { valid: false, reason: `Unknown swapper: ${swapperName}` };
    }

    if (!config.supportsDestinationAddress) {
      return {
        valid: false,
        reason: `${swapperName} does not support destination addresses`,
      };
    }

    // Additional validation can be added here based on asset pairs,
    // chain support, etc.

    return { valid: true };
  }
}
