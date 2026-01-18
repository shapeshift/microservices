import { SwapperName, SwapperType, SwapperConfig } from './swapper.types';

/**
 * Swapper Configuration Constants
 *
 * This file centralizes all swapper configuration for the send-swap-service.
 * It defines which swappers are supported, excluded, and their classifications.
 *
 * Based on spec.md Swapper Classification Reference and isCrossAccountTradeSupported
 * function from ShapeShift web repo.
 */

/**
 * Excluded swappers - these don't support destination addresses
 * CRITICAL: These swappers MUST be excluded - they don't support external destination addresses
 */
export const EXCLUDED_SWAPPERS: readonly SwapperName[] = [
  SwapperName.Zrx,           // No receiveAddress support
  SwapperName.CowSwap,       // No receiveAddress support
  SwapperName.ArbitrumBridge, // Disabled for simplicity
  SwapperName.Portals,       // No receiveAddress support
  SwapperName.Cetus,         // No receiveAddress support
  SwapperName.Sunio,         // No receiveAddress support
  SwapperName.Avnu,          // No receiveAddress support
  SwapperName.Stonfi,        // No receiveAddress support
] as const;

/**
 * Set of excluded swappers for O(1) lookup
 */
export const EXCLUDED_SWAPPERS_SET: ReadonlySet<SwapperName> = new Set(EXCLUDED_SWAPPERS);

/**
 * Direct execution swappers - these provide their own deposit addresses
 * and handle swaps natively (no service custody required)
 */
export const DIRECT_SWAPPERS: readonly SwapperName[] = [
  SwapperName.Chainflip,
  SwapperName.NearIntents,
] as const;

/**
 * Set of direct swappers for O(1) lookup
 */
export const DIRECT_SWAPPERS_SET: ReadonlySet<SwapperName> = new Set(DIRECT_SWAPPERS);

/**
 * Service-wallet swappers that support destination addresses
 * These require the service to receive funds first and execute on behalf of user
 */
export const SERVICE_WALLET_SWAPPERS: readonly SwapperName[] = [
  SwapperName.THORChain,
  SwapperName.Jupiter,
  SwapperName.Relay,
  SwapperName.Mayachain,
  SwapperName.ButterSwap,
  SwapperName.Bebop,
] as const;

/**
 * Set of service-wallet swappers for O(1) lookup
 */
export const SERVICE_WALLET_SWAPPERS_SET: ReadonlySet<SwapperName> = new Set(SERVICE_WALLET_SWAPPERS);

/**
 * All valid swappers (both direct and service-wallet that support destination addresses)
 */
export const VALID_SWAPPERS: readonly SwapperName[] = [
  ...DIRECT_SWAPPERS,
  ...SERVICE_WALLET_SWAPPERS,
] as const;

/**
 * Set of valid swappers for O(1) lookup
 */
export const VALID_SWAPPERS_SET: ReadonlySet<SwapperName> = new Set(VALID_SWAPPERS);

/**
 * Check if a swapper is excluded (doesn't support destination addresses)
 */
export function isExcludedSwapper(swapperName: SwapperName): boolean {
  return EXCLUDED_SWAPPERS_SET.has(swapperName);
}

/**
 * Check if a swapper is valid for send-swap operations
 */
export function isValidSwapper(swapperName: SwapperName): boolean {
  return VALID_SWAPPERS_SET.has(swapperName);
}

/**
 * Check if a swapper is a direct execution swapper
 */
export function isDirectSwapper(swapperName: SwapperName): boolean {
  return DIRECT_SWAPPERS_SET.has(swapperName);
}

/**
 * Check if a swapper is a service-wallet swapper (that supports destination addresses)
 */
export function isServiceWalletSwapper(swapperName: SwapperName): boolean {
  return SERVICE_WALLET_SWAPPERS_SET.has(swapperName);
}

/**
 * Filter a list of swapper names to only include valid ones
 * (excludes swappers that don't support destination addresses)
 */
export function filterValidSwappers(swapperNames: SwapperName[]): SwapperName[] {
  return swapperNames.filter((name) => !isExcludedSwapper(name));
}

/**
 * Get the swapper type for a given swapper name
 */
export function getSwapperTypeFromConfig(swapperName: SwapperName): SwapperType {
  if (DIRECT_SWAPPERS_SET.has(swapperName)) {
    return SwapperType.DIRECT;
  }
  return SwapperType.SERVICE_WALLET;
}

/**
 * Full swapper configuration map
 * Provides detailed configuration for each swapper
 */
export const SWAPPER_CONFIGS: ReadonlyMap<SwapperName, SwapperConfig> = new Map<SwapperName, SwapperConfig>([
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
 * Get swapper configuration by name
 */
export function getSwapperConfig(swapperName: SwapperName): SwapperConfig | undefined {
  return SWAPPER_CONFIGS.get(swapperName);
}
