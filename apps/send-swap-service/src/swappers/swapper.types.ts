/**
 * Swapper type classification for send-swap-service
 *
 * DIRECT: Swappers that provide their own deposit addresses and handle swaps natively.
 *         The service doesn't need to custody funds - user deposits go directly to the swapper.
 *         Examples: Chainflip, NEAR Intents
 *
 * SERVICE_WALLET: Swappers that require the service to receive funds first and execute
 *                 the swap on behalf of the user. Requires gas fee overhead calculation.
 *                 Examples: THORChain, Jupiter, Relay, Mayachain
 */
export enum SwapperType {
  DIRECT = 'DIRECT',
  SERVICE_WALLET = 'SERVICE_WALLET',
}

/**
 * Swapper names as constants for type safety
 * Based on @shapeshiftoss/swapper SwapperName enum
 */
export enum SwapperName {
  // Direct execution swappers
  Chainflip = 'Chainflip',
  NearIntents = 'NearIntents',

  // Service-wallet swappers
  THORChain = 'THORChain',
  Jupiter = 'Jupiter',
  Relay = 'Relay',
  Mayachain = 'Mayachain',
  ButterSwap = 'ButterSwap',
  Bebop = 'Bebop',

  // Excluded swappers (no destination address support)
  Zrx = 'Zrx',
  CowSwap = 'CowSwap',
  ArbitrumBridge = 'ArbitrumBridge',
  Portals = 'Portals',
  Cetus = 'Cetus',
  Sunio = 'Sunio',
  Avnu = 'Avnu',
  Stonfi = 'Stonfi',
}

/**
 * Swapper configuration interface
 */
export interface SwapperConfig {
  name: SwapperName;
  type: SwapperType;
  supportsDestinationAddress: boolean;
  description: string;
}

/**
 * Deposit address information returned by direct swappers
 */
export interface DirectSwapperDepositInfo {
  depositAddress: string;
  depositMemo?: string;
  expiresAt?: Date;
  depositChannel?: string;
}

/**
 * Quote request interface for swapper manager
 */
export interface SwapperQuoteRequest {
  sellAssetId: string;
  buyAssetId: string;
  sellAmountCryptoBaseUnit: string;
  receiveAddress: string;
  slippageTolerancePercentage?: number;
}

/**
 * Swapper quote response interface
 */
export interface SwapperQuote {
  swapperName: SwapperName;
  swapperType: SwapperType;
  depositAddress: string;
  depositMemo?: string;
  expectedBuyAmountCryptoBaseUnit: string;
  expiresAt: Date;
  gasOverheadBaseUnit?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result of getting available swappers for a pair
 */
export interface AvailableSwapper {
  name: SwapperName;
  type: SwapperType;
  config: SwapperConfig;
}
