import { Injectable, Logger } from '@nestjs/common';
import { SwapperType } from './swapper.types';

/**
 * Chain identifiers for gas overhead calculation
 * Using CAIP-2 chain ID prefixes where applicable
 */
export enum ChainId {
  // EVM Chains
  ETH = 'eip155:1',
  AVAX = 'eip155:43114',
  BSC = 'eip155:56',
  POLYGON = 'eip155:137',
  OPTIMISM = 'eip155:10',
  ARBITRUM = 'eip155:42161',
  BASE = 'eip155:8453',
  GNOSIS = 'eip155:100',

  // UTXO Chains
  BTC = 'bip122:000000000019d6689c085ae165831e93',
  LTC = 'bip122:12a765e31ffd4059bada1e25190f6e98',
  DOGE = 'bip122:1a91e3dace36e2be3bf030a65679fe82',
  BCH = 'bip122:000000000000000000651ef99cb9fcbe',

  // Cosmos-SDK Chains
  ATOM = 'cosmos:cosmoshub-4',
  OSMO = 'cosmos:osmosis-1',

  // Solana
  SOL = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
}

/**
 * Chain family types for different gas calculation strategies
 */
export enum ChainFamily {
  EVM = 'EVM',
  UTXO = 'UTXO',
  COSMOS = 'COSMOS',
  SOLANA = 'SOLANA',
}

/**
 * Gas overhead configuration for a specific chain
 */
export interface GasOverheadConfig {
  chainId: ChainId;
  chainFamily: ChainFamily;
  /** Base gas overhead in the chain's native base unit (wei, satoshi, lamports, etc.) */
  baseOverhead: string;
  /** Percentage buffer to add for price volatility (e.g., 1.1 = 10% buffer) */
  volatilityBuffer: number;
  /** Human-readable description of the overhead estimation */
  description: string;
}

/**
 * Gas overhead configuration by chain
 *
 * Values are estimated based on typical swap transaction costs:
 * - EVM: Approve + swap transaction gas costs
 * - UTXO: Transaction size-based fees
 * - Cosmos: Fixed gas costs per transaction type
 * - Solana: Compute unit costs
 *
 * All values are in the chain's smallest denomination (base units):
 * - ETH/EVM: wei (1 ETH = 10^18 wei)
 * - BTC/UTXO: satoshi (1 BTC = 10^8 satoshi)
 * - Cosmos: uatom/uosmo (1 ATOM = 10^6 uatom)
 * - Solana: lamports (1 SOL = 10^9 lamports)
 */
export const GAS_OVERHEAD_BY_CHAIN: ReadonlyMap<ChainId, GasOverheadConfig> = new Map([
  // EVM Chains - estimated at ~300k gas with typical gas prices
  [
    ChainId.ETH,
    {
      chainId: ChainId.ETH,
      chainFamily: ChainFamily.EVM,
      // ~0.003 ETH at 10 gwei for 300k gas
      baseOverhead: '3000000000000000', // 0.003 ETH in wei
      volatilityBuffer: 1.2, // 20% buffer for ETH gas volatility
      description: 'Ethereum mainnet - high gas fees, volatile',
    },
  ],
  [
    ChainId.AVAX,
    {
      chainId: ChainId.AVAX,
      chainFamily: ChainFamily.EVM,
      // ~0.005 AVAX at 25 nAVAX for 200k gas
      baseOverhead: '5000000000000000', // 0.005 AVAX in wei
      volatilityBuffer: 1.15,
      description: 'Avalanche C-Chain - moderate gas fees',
    },
  ],
  [
    ChainId.BSC,
    {
      chainId: ChainId.BSC,
      chainFamily: ChainFamily.EVM,
      // ~0.0003 BNB at 3 gwei for 100k gas
      baseOverhead: '300000000000000', // 0.0003 BNB in wei
      volatilityBuffer: 1.1,
      description: 'BNB Smart Chain - low gas fees',
    },
  ],
  [
    ChainId.POLYGON,
    {
      chainId: ChainId.POLYGON,
      chainFamily: ChainFamily.EVM,
      // ~0.01 MATIC at 50 gwei for 200k gas
      baseOverhead: '10000000000000000', // 0.01 MATIC in wei
      volatilityBuffer: 1.15,
      description: 'Polygon PoS - low gas fees, can spike',
    },
  ],
  [
    ChainId.OPTIMISM,
    {
      chainId: ChainId.OPTIMISM,
      chainFamily: ChainFamily.EVM,
      // ~0.0002 ETH for L2 transaction
      baseOverhead: '200000000000000', // 0.0002 ETH in wei
      volatilityBuffer: 1.1,
      description: 'Optimism L2 - low gas fees',
    },
  ],
  [
    ChainId.ARBITRUM,
    {
      chainId: ChainId.ARBITRUM,
      chainFamily: ChainFamily.EVM,
      // ~0.0002 ETH for L2 transaction
      baseOverhead: '200000000000000', // 0.0002 ETH in wei
      volatilityBuffer: 1.1,
      description: 'Arbitrum One L2 - low gas fees',
    },
  ],
  [
    ChainId.BASE,
    {
      chainId: ChainId.BASE,
      chainFamily: ChainFamily.EVM,
      // ~0.00015 ETH for L2 transaction
      baseOverhead: '150000000000000', // 0.00015 ETH in wei
      volatilityBuffer: 1.1,
      description: 'Base L2 - very low gas fees',
    },
  ],
  [
    ChainId.GNOSIS,
    {
      chainId: ChainId.GNOSIS,
      chainFamily: ChainFamily.EVM,
      // ~0.0001 xDAI for transaction
      baseOverhead: '100000000000000', // 0.0001 xDAI in wei
      volatilityBuffer: 1.1,
      description: 'Gnosis Chain - very low gas fees',
    },
  ],

  // UTXO Chains - based on typical transaction sizes
  [
    ChainId.BTC,
    {
      chainId: ChainId.BTC,
      chainFamily: ChainFamily.UTXO,
      // ~10,000 satoshi for 250-byte tx at 40 sat/vbyte
      baseOverhead: '10000', // 0.0001 BTC in satoshi
      volatilityBuffer: 1.3, // 30% buffer for BTC fee volatility
      description: 'Bitcoin - fees vary by mempool congestion',
    },
  ],
  [
    ChainId.LTC,
    {
      chainId: ChainId.LTC,
      chainFamily: ChainFamily.UTXO,
      // ~2,000 litoshi for typical transaction
      baseOverhead: '2000', // 0.00002 LTC in litoshi
      volatilityBuffer: 1.1,
      description: 'Litecoin - low fees',
    },
  ],
  [
    ChainId.DOGE,
    {
      chainId: ChainId.DOGE,
      chainFamily: ChainFamily.UTXO,
      // ~100,000,000 (1 DOGE) minimum fee
      baseOverhead: '100000000', // 1 DOGE in koinu
      volatilityBuffer: 1.1,
      description: 'Dogecoin - 1 DOGE minimum fee',
    },
  ],
  [
    ChainId.BCH,
    {
      chainId: ChainId.BCH,
      chainFamily: ChainFamily.UTXO,
      // ~500 satoshi for typical transaction
      baseOverhead: '500', // 0.000005 BCH in satoshi
      volatilityBuffer: 1.1,
      description: 'Bitcoin Cash - very low fees',
    },
  ],

  // Cosmos-SDK Chains
  [
    ChainId.ATOM,
    {
      chainId: ChainId.ATOM,
      chainFamily: ChainFamily.COSMOS,
      // ~5,000 uatom (0.005 ATOM) for typical transaction
      baseOverhead: '5000', // 0.005 ATOM in uatom
      volatilityBuffer: 1.1,
      description: 'Cosmos Hub - fixed gas prices',
    },
  ],
  [
    ChainId.OSMO,
    {
      chainId: ChainId.OSMO,
      chainFamily: ChainFamily.COSMOS,
      // ~2,500 uosmo (0.0025 OSMO) for typical transaction
      baseOverhead: '2500', // 0.0025 OSMO in uosmo
      volatilityBuffer: 1.1,
      description: 'Osmosis - low gas fees',
    },
  ],

  // Solana
  [
    ChainId.SOL,
    {
      chainId: ChainId.SOL,
      chainFamily: ChainFamily.SOLANA,
      // ~5000 lamports base + priority fee estimate
      baseOverhead: '10000000', // 0.01 SOL in lamports (includes priority fee buffer)
      volatilityBuffer: 1.15,
      description: 'Solana - low fees, may need priority fees',
    },
  ],
]);

/**
 * Default gas overhead for unknown chains
 */
const DEFAULT_GAS_OVERHEAD: GasOverheadConfig = {
  chainId: ChainId.ETH, // Placeholder
  chainFamily: ChainFamily.EVM,
  baseOverhead: '5000000000000000', // 0.005 ETH equivalent - conservative default
  volatilityBuffer: 1.25,
  description: 'Default overhead for unknown chains - conservative estimate',
};

/**
 * GasCalculatorService calculates chain-specific gas overhead for service-wallet swappers.
 *
 * This service is used to add gas fee buffers to quotes when the service needs to
 * custody user funds and execute swaps on their behalf. This ensures the service
 * doesn't lose money on gas fees.
 *
 * Key responsibilities:
 * - Calculate gas overhead for a specific chain
 * - Apply volatility buffers for networks with variable gas prices
 * - Support multiple chain families (EVM, UTXO, Cosmos, Solana)
 */
@Injectable()
export class GasCalculatorService {
  private readonly logger = new Logger(GasCalculatorService.name);

  /**
   * Get gas overhead configuration for a chain
   */
  getGasOverheadConfig(chainId: ChainId): GasOverheadConfig {
    const config = GAS_OVERHEAD_BY_CHAIN.get(chainId);

    if (!config) {
      this.logger.warn(
        `No gas overhead config for chain ${chainId}, using default`,
      );
      return DEFAULT_GAS_OVERHEAD;
    }

    return config;
  }

  /**
   * Calculate gas overhead for a swap on a specific chain
   *
   * @param chainId - The chain identifier
   * @param swapperType - The swapper type (DIRECT swappers don't need overhead)
   * @returns Gas overhead in base units (wei, satoshi, lamports, etc.)
   */
  calculateGasOverhead(chainId: ChainId, swapperType: SwapperType): string {
    // Direct swappers don't need gas overhead - they handle their own execution
    if (swapperType === SwapperType.DIRECT) {
      this.logger.debug(
        `Skipping gas overhead for DIRECT swapper on ${chainId}`,
      );
      return '0';
    }

    const config = this.getGasOverheadConfig(chainId);

    // Apply volatility buffer to base overhead
    const baseOverhead = BigInt(config.baseOverhead);
    const bufferedOverhead =
      (baseOverhead * BigInt(Math.round(config.volatilityBuffer * 100))) /
      BigInt(100);

    this.logger.debug(
      `Gas overhead for ${chainId}: ${bufferedOverhead.toString()} (base: ${config.baseOverhead}, buffer: ${config.volatilityBuffer}x)`,
    );

    return bufferedOverhead.toString();
  }

  /**
   * Calculate gas overhead from a CAIP-2 formatted asset ID
   *
   * Asset IDs follow format: chainNamespace:chainReference/assetNamespace:assetReference
   * e.g., "eip155:1/slip44:60" for ETH on Ethereum mainnet
   *
   * @param assetId - CAIP-19 asset identifier
   * @param swapperType - The swapper type
   * @returns Gas overhead in base units
   */
  calculateGasOverheadFromAssetId(
    assetId: string,
    swapperType: SwapperType,
  ): string {
    const chainId = this.extractChainIdFromAssetId(assetId);

    if (!chainId) {
      this.logger.warn(
        `Could not extract chain ID from asset: ${assetId}, using default overhead`,
      );
      return this.calculateGasOverheadWithConfig(
        DEFAULT_GAS_OVERHEAD,
        swapperType,
      );
    }

    return this.calculateGasOverhead(chainId, swapperType);
  }

  /**
   * Extract ChainId from a CAIP-19 asset identifier
   *
   * @param assetId - Full asset identifier (e.g., "eip155:1/slip44:60")
   * @returns ChainId enum value or undefined
   */
  extractChainIdFromAssetId(assetId: string): ChainId | undefined {
    // Extract chain part from asset ID (everything before the "/")
    const chainPart = assetId.split('/')[0];

    if (!chainPart) {
      return undefined;
    }

    // Check if it matches any known chain ID
    for (const chainId of Object.values(ChainId)) {
      if (chainId === chainPart) {
        return chainId;
      }
    }

    return undefined;
  }

  /**
   * Calculate gas overhead with a specific config
   * Internal helper for applying volatility buffer
   */
  private calculateGasOverheadWithConfig(
    config: GasOverheadConfig,
    swapperType: SwapperType,
  ): string {
    if (swapperType === SwapperType.DIRECT) {
      return '0';
    }

    const baseOverhead = BigInt(config.baseOverhead);
    const bufferedOverhead =
      (baseOverhead * BigInt(Math.round(config.volatilityBuffer * 100))) /
      BigInt(100);

    return bufferedOverhead.toString();
  }

  /**
   * Get the chain family for a chain ID
   */
  getChainFamily(chainId: ChainId): ChainFamily {
    const config = GAS_OVERHEAD_BY_CHAIN.get(chainId);
    return config?.chainFamily ?? ChainFamily.EVM;
  }

  /**
   * Check if a chain is supported for gas estimation
   */
  isSupportedChain(chainId: ChainId): boolean {
    return GAS_OVERHEAD_BY_CHAIN.has(chainId);
  }

  /**
   * Get all supported chain IDs
   */
  getSupportedChains(): ChainId[] {
    return Array.from(GAS_OVERHEAD_BY_CHAIN.keys());
  }

  /**
   * Get gas overhead summary for logging/debugging
   */
  getGasOverheadSummary(): Record<string, { overhead: string; family: string }> {
    const summary: Record<string, { overhead: string; family: string }> = {};

    for (const [chainId, config] of GAS_OVERHEAD_BY_CHAIN.entries()) {
      summary[chainId] = {
        overhead: config.baseOverhead,
        family: config.chainFamily,
      };
    }

    return summary;
  }

  /**
   * Log gas overhead configuration (useful for debugging at startup)
   */
  logGasOverheadConfig(): void {
    this.logger.log('=== Gas Overhead Configuration ===');

    const byFamily: Record<ChainFamily, string[]> = {
      [ChainFamily.EVM]: [],
      [ChainFamily.UTXO]: [],
      [ChainFamily.COSMOS]: [],
      [ChainFamily.SOLANA]: [],
    };

    for (const [chainId, config] of GAS_OVERHEAD_BY_CHAIN.entries()) {
      byFamily[config.chainFamily].push(
        `${chainId}: ${config.baseOverhead} (${config.volatilityBuffer}x buffer)`,
      );
    }

    for (const [family, chains] of Object.entries(byFamily)) {
      if (chains.length > 0) {
        this.logger.log(`${family} chains:`);
        for (const chain of chains) {
          this.logger.log(`  - ${chain}`);
        }
      }
    }
  }
}
