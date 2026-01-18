import { Injectable, Logger } from '@nestjs/common';
import {
  SwapperType,
  SwapperName,
  SwapperConfig,
  AvailableSwapper,
  SwapperQuoteRequest,
} from './swapper.types';

/**
 * SwapperManagerService handles swapper classification, filtering, and management.
 *
 * Key responsibilities:
 * - Classify swappers as DIRECT or SERVICE_WALLET
 * - Filter out swappers that don't support destination addresses
 * - Provide swapper configuration for quote generation
 */
@Injectable()
export class SwapperManagerService {
  private readonly logger = new Logger(SwapperManagerService.name);

  /**
   * Swapper classification configuration
   * Based on spec.md Swapper Classification Reference section
   */
  private readonly swapperConfigs: Map<SwapperName, SwapperConfig> = new Map([
    // Direct execution swappers - provide their own deposit addresses
    [
      SwapperName.Chainflip,
      {
        name: SwapperName.Chainflip,
        type: SwapperType.DIRECT,
        supportsDestinationAddress: true,
        description: 'Uses requestDepositAddressV2() API with fillOrKillParams',
      },
    ],
    [
      SwapperName.NearIntents,
      {
        name: SwapperName.NearIntents,
        type: SwapperType.DIRECT,
        supportsDestinationAddress: true,
        description: 'Uses 1Click REST API with JWT authentication',
      },
    ],

    // Service-wallet swappers - require service to custody and execute
    [
      SwapperName.THORChain,
      {
        name: SwapperName.THORChain,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: true,
        description: 'Memo-based routing, rate limited 1 req/sec on /quote',
      },
    ],
    [
      SwapperName.Jupiter,
      {
        name: SwapperName.Jupiter,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: true,
        description: 'Solana swap execution (Solana only)',
      },
    ],
    [
      SwapperName.Relay,
      {
        name: SwapperName.Relay,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: true,
        description: 'Cross-chain bridging',
      },
    ],
    [
      SwapperName.Mayachain,
      {
        name: SwapperName.Mayachain,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: true,
        description: 'Maya protocol swaps',
      },
    ],
    [
      SwapperName.ButterSwap,
      {
        name: SwapperName.ButterSwap,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: true,
        description: 'Multi-chain swaps',
      },
    ],
    [
      SwapperName.Bebop,
      {
        name: SwapperName.Bebop,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: true,
        description: 'Intent-based swaps',
      },
    ],

    // Excluded swappers - no destination address support
    [
      SwapperName.Zrx,
      {
        name: SwapperName.Zrx,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
    [
      SwapperName.CowSwap,
      {
        name: SwapperName.CowSwap,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
    [
      SwapperName.ArbitrumBridge,
      {
        name: SwapperName.ArbitrumBridge,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'Disabled for simplicity - EXCLUDED',
      },
    ],
    [
      SwapperName.Portals,
      {
        name: SwapperName.Portals,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
    [
      SwapperName.Cetus,
      {
        name: SwapperName.Cetus,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
    [
      SwapperName.Sunio,
      {
        name: SwapperName.Sunio,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
    [
      SwapperName.Avnu,
      {
        name: SwapperName.Avnu,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
    [
      SwapperName.Stonfi,
      {
        name: SwapperName.Stonfi,
        type: SwapperType.SERVICE_WALLET,
        supportsDestinationAddress: false,
        description: 'No receiveAddress support - EXCLUDED',
      },
    ],
  ]);

  /**
   * Get swapper type classification (DIRECT or SERVICE_WALLET)
   */
  getSwapperType(swapperName: SwapperName): SwapperType {
    const config = this.swapperConfigs.get(swapperName);
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
    const config = this.swapperConfigs.get(swapperName);
    if (!config) {
      this.logger.warn(
        `Unknown swapper: ${swapperName}, assuming no destination address support`,
      );
      return false;
    }
    return config.supportsDestinationAddress;
  }

  /**
   * Get configuration for a specific swapper
   */
  getSwapperConfig(swapperName: SwapperName): SwapperConfig | undefined {
    return this.swapperConfigs.get(swapperName);
  }

  /**
   * Get all valid swappers for send-swap (filters out excluded ones)
   */
  getValidSwappers(): AvailableSwapper[] {
    const validSwappers: AvailableSwapper[] = [];

    for (const [name, config] of this.swapperConfigs.entries()) {
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

    for (const config of this.swapperConfigs.values()) {
      if (!config.supportsDestinationAddress) {
        excluded.push(config);
      }
    }

    return excluded;
  }

  /**
   * Filter a list of swapper names to only include valid ones
   */
  filterValidSwapperNames(swapperNames: SwapperName[]): SwapperName[] {
    return swapperNames.filter((name) => this.supportsDestinationAddress(name));
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
    const config = this.swapperConfigs.get(swapperName);

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
