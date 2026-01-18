import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RouteCacheService } from './route-cache.service';
import { SwapperName } from '@shapeshiftoss/swapper';
import createGraph, { Graph } from 'ngraph.graph';

/**
 * Edge data representing a swap route between two assets via a specific swapper
 */
export interface RouteEdgeData {
  swapperName: SwapperName;
  sellAssetId: string;
  buyAssetId: string;
  /** Whether this is a cross-chain swap */
  isCrossChain: boolean;
  /** Chain ID of the sell asset */
  sellChainId: string;
  /** Chain ID of the buy asset */
  buyChainId: string;
}

/**
 * Node data representing an asset in the route graph
 */
export interface RouteNodeData {
  assetId: string;
  chainId: string;
}

/**
 * A swapper route pair representing a supported swap
 */
export interface SwapperRoutePair {
  swapperName: SwapperName;
  sellAssetId: string;
  buyAssetId: string;
  sellChainId: string;
  buyChainId: string;
}

/**
 * Statistics about the route graph
 */
export interface RouteGraphStats {
  nodeCount: number;
  edgeCount: number;
  swapperCounts: Record<string, number>;
  crossChainEdgeCount: number;
  lastBuildTime: number | null;
  lastBuildDurationMs: number | null;
}

/**
 * RouteGraphService - Builds and maintains the route graph from available swapper pairs.
 *
 * This service:
 * - Constructs a directed graph where nodes are assets and edges are swap routes
 * - Queries swappers for their supported asset pairs
 * - Maintains edge metadata including swapper name and cross-chain status
 * - Provides graph access for pathfinding operations
 *
 * The graph structure enables efficient pathfinding to discover multi-hop routes
 * when direct swaps are not available.
 */
@Injectable()
export class RouteGraphService implements OnModuleInit {
  private readonly logger = new Logger(RouteGraphService.name);
  private graph: Graph<RouteNodeData, RouteEdgeData>;
  private graphStats: RouteGraphStats = {
    nodeCount: 0,
    edgeCount: 0,
    swapperCounts: {},
    crossChainEdgeCount: 0,
    lastBuildTime: null,
    lastBuildDurationMs: null,
  };

  constructor(
    private readonly cacheService: RouteCacheService,
    private readonly httpService: HttpService,
  ) {
    this.graph = createGraph<RouteNodeData, RouteEdgeData>();
    this.logger.log('RouteGraphService initialized');
  }

  /**
   * Initialize the route graph on module startup
   */
  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Building initial route graph...');
      await this.buildGraph();
      this.logger.log(
        `Initial route graph built: ${this.graphStats.nodeCount} nodes, ${this.graphStats.edgeCount} edges`,
      );
    } catch (error) {
      this.logger.error('Failed to build initial route graph', error);
      // Don't throw - allow service to start even if initial build fails
      // The graph can be rebuilt later via refresh
    }
  }

  /**
   * Get the underlying ngraph instance for pathfinding operations
   * @returns The ngraph Graph instance
   */
  getGraph(): Graph<RouteNodeData, RouteEdgeData> {
    return this.graph;
  }

  /**
   * Get current graph statistics
   * @returns Graph statistics including node/edge counts
   */
  getStats(): RouteGraphStats {
    return { ...this.graphStats };
  }

  /**
   * Build the route graph from available swapper pairs.
   * This rebuilds the entire graph from scratch.
   */
  async buildGraph(): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting route graph build...');

      // Create a fresh graph instance
      this.graph = createGraph<RouteNodeData, RouteEdgeData>();

      // Get available routes from all swappers
      const routePairs = await this.getAvailableRoutes();

      this.logger.log(`Found ${routePairs.length} route pairs from swappers`);

      // Reset swapper counts
      const swapperCounts: Record<string, number> = {};
      let crossChainEdgeCount = 0;

      // Add nodes and edges to the graph
      for (const pair of routePairs) {
        // Add nodes for both assets if they don't exist
        if (!this.graph.hasNode(pair.sellAssetId)) {
          this.graph.addNode(pair.sellAssetId, {
            assetId: pair.sellAssetId,
            chainId: pair.sellChainId,
          });
        }

        if (!this.graph.hasNode(pair.buyAssetId)) {
          this.graph.addNode(pair.buyAssetId, {
            assetId: pair.buyAssetId,
            chainId: pair.buyChainId,
          });
        }

        // Determine if this is a cross-chain swap
        const isCrossChain = pair.sellChainId !== pair.buyChainId;

        // Add edge (directed: sell -> buy)
        // Note: ngraph allows multiple edges between same nodes via different link IDs
        const existingLink = this.graph.getLink(pair.sellAssetId, pair.buyAssetId);

        // Only add if this specific swapper route doesn't exist
        if (!existingLink || !this.hasEdgeWithSwapper(pair.sellAssetId, pair.buyAssetId, pair.swapperName)) {
          this.graph.addLink(pair.sellAssetId, pair.buyAssetId, {
            swapperName: pair.swapperName,
            sellAssetId: pair.sellAssetId,
            buyAssetId: pair.buyAssetId,
            isCrossChain,
            sellChainId: pair.sellChainId,
            buyChainId: pair.buyChainId,
          });

          // Track statistics
          swapperCounts[pair.swapperName] = (swapperCounts[pair.swapperName] || 0) + 1;
          if (isCrossChain) {
            crossChainEdgeCount++;
          }
        }
      }

      // Update statistics
      const buildDuration = Date.now() - startTime;
      this.graphStats = {
        nodeCount: this.graph.getNodeCount(),
        edgeCount: this.graph.getLinkCount(),
        swapperCounts,
        crossChainEdgeCount,
        lastBuildTime: Date.now(),
        lastBuildDurationMs: buildDuration,
      };

      this.logger.log(
        `Route graph built in ${buildDuration}ms: ${this.graphStats.nodeCount} nodes, ${this.graphStats.edgeCount} edges, ${crossChainEdgeCount} cross-chain routes`,
      );

      // Clear route cache since graph has changed
      this.cacheService.clear();
    } catch (error) {
      this.logger.error('Failed to build route graph', error);
      throw error;
    }
  }

  /**
   * Query all available swap routes from supported swappers.
   * Queries each swapper's API in parallel to discover available trading pairs.
   *
   * @returns Array of supported swap route pairs
   */
  async getAvailableRoutes(): Promise<SwapperRoutePair[]> {
    this.logger.log('Querying available routes from all swappers...');
    const allPairs: SwapperRoutePair[] = [];

    // Query all swappers in parallel for better performance
    const results = await Promise.allSettled([
      this.getThorchainRoutes(),
      this.getMayachainRoutes(),
      this.getChainflipRoutes(),
      this.getCowSwapRoutes(),
      this.getZrxRoutes(),
      this.getRelayRoutes(),
      this.getPortalsRoutes(),
      this.getJupiterRoutes(),
    ]);

    // Aggregate results from successful queries
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allPairs.push(...result.value);
      }
      // Errors are already logged in individual methods
    }

    this.logger.log(`Aggregated ${allPairs.length} total route pairs from swappers`);
    return allPairs;
  }

  /**
   * Get available routes from Thorchain via Midgard API
   * Each pool creates bidirectional routes between RUNE and the pool asset
   */
  private async getThorchainRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      const midgardUrl = process.env.VITE_THORCHAIN_MIDGARD_URL || 'https://midgard.thorchain.info';
      const poolsUrl = `${midgardUrl}/v2/pools`;

      this.logger.debug(`Fetching Thorchain pools from ${poolsUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(poolsUrl, { timeout: 10000 }),
      );

      const pools = response.data;

      if (!Array.isArray(pools)) {
        this.logger.warn('Thorchain pools response is not an array');
        return pairs;
      }

      // RUNE native asset ID
      const runeAssetId = 'cosmos:thorchain-mainnet-v1/slip44:931';
      const runeChainId = 'cosmos:thorchain-mainnet-v1';

      for (const pool of pools) {
        // Skip non-available pools
        if (pool.status !== 'available') continue;

        const poolAsset = pool.asset; // e.g., "BTC.BTC", "ETH.ETH", "ETH.USDC-0xA0b..."
        const assetId = this.thorchainAssetToAssetId(poolAsset);
        const chainId = this.thorchainAssetToChainId(poolAsset);

        if (!assetId || !chainId) {
          this.logger.debug(`Skipping unknown Thorchain pool asset: ${poolAsset}`);
          continue;
        }

        // Add bidirectional routes: RUNE <-> Pool Asset
        pairs.push({
          swapperName: SwapperName.Thorchain,
          sellAssetId: runeAssetId,
          buyAssetId: assetId,
          sellChainId: runeChainId,
          buyChainId: chainId,
        });

        pairs.push({
          swapperName: SwapperName.Thorchain,
          sellAssetId: assetId,
          buyAssetId: runeAssetId,
          sellChainId: chainId,
          buyChainId: runeChainId,
        });
      }

      this.logger.log(`Found ${pairs.length} Thorchain route pairs from ${pools.length} pools`);
    } catch (error) {
      this.logger.error('Failed to fetch Thorchain routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from Mayachain via Midgard API
   * Each pool creates bidirectional routes between CACAO and the pool asset
   */
  private async getMayachainRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      const midgardUrl = process.env.VITE_MAYACHAIN_MIDGARD_URL || 'https://midgard.mayachain.info';
      const poolsUrl = `${midgardUrl}/v2/pools`;

      this.logger.debug(`Fetching Mayachain pools from ${poolsUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(poolsUrl, { timeout: 10000 }),
      );

      const pools = response.data;

      if (!Array.isArray(pools)) {
        this.logger.warn('Mayachain pools response is not an array');
        return pairs;
      }

      // CACAO native asset ID
      const cacaoAssetId = 'cosmos:mayachain-mainnet-v1/slip44:931';
      const cacaoChainId = 'cosmos:mayachain-mainnet-v1';

      for (const pool of pools) {
        if (pool.status !== 'available') continue;

        const poolAsset = pool.asset;
        const assetId = this.mayachainAssetToAssetId(poolAsset);
        const chainId = this.mayachainAssetToChainId(poolAsset);

        if (!assetId || !chainId) {
          this.logger.debug(`Skipping unknown Mayachain pool asset: ${poolAsset}`);
          continue;
        }

        // Add bidirectional routes: CACAO <-> Pool Asset
        pairs.push({
          swapperName: SwapperName.Mayachain,
          sellAssetId: cacaoAssetId,
          buyAssetId: assetId,
          sellChainId: cacaoChainId,
          buyChainId: chainId,
        });

        pairs.push({
          swapperName: SwapperName.Mayachain,
          sellAssetId: assetId,
          buyAssetId: cacaoAssetId,
          sellChainId: chainId,
          buyChainId: cacaoChainId,
        });
      }

      this.logger.log(`Found ${pairs.length} Mayachain route pairs from ${pools.length} pools`);
    } catch (error) {
      this.logger.error('Failed to fetch Mayachain routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from Chainflip
   * Returns cross-chain swap pairs supported by Chainflip
   */
  private async getChainflipRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      const chainflipApiUrl = process.env.VITE_CHAINFLIP_API_URL || 'https://chainflip-broker.io';
      const assetsUrl = `${chainflipApiUrl}/assets`;

      const headers: Record<string, string> = {};
      const apiKey = process.env.VITE_CHAINFLIP_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      this.logger.debug(`Fetching Chainflip assets from ${assetsUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(assetsUrl, { headers, timeout: 10000 }),
      );

      const assets = response.data?.assets || response.data || [];

      if (!Array.isArray(assets)) {
        this.logger.warn('Chainflip assets response is not an array');
        return pairs;
      }

      // Chainflip supports swaps between all listed assets
      // Create pairs for each combination
      const chainflipAssets = assets
        .filter((asset: any) => asset.enabled !== false)
        .map((asset: any) => ({
          assetId: this.chainflipAssetToAssetId(asset),
          chainId: this.chainflipAssetToChainId(asset),
          symbol: asset.symbol || asset.asset,
        }))
        .filter((a: any) => a.assetId && a.chainId);

      // Create all possible pairs (excluding same asset)
      for (const sellAsset of chainflipAssets) {
        for (const buyAsset of chainflipAssets) {
          if (sellAsset.assetId === buyAsset.assetId) continue;

          pairs.push({
            swapperName: SwapperName.Chainflip,
            sellAssetId: sellAsset.assetId,
            buyAssetId: buyAsset.assetId,
            sellChainId: sellAsset.chainId,
            buyChainId: buyAsset.chainId,
          });
        }
      }

      this.logger.log(`Found ${pairs.length} Chainflip route pairs from ${chainflipAssets.length} assets`);
    } catch (error) {
      this.logger.error('Failed to fetch Chainflip routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from CowSwap
   * CowSwap supports EVM chain swaps - primarily Ethereum and Gnosis Chain
   */
  private async getCowSwapRoutes(): Promise<SwapperRoutePair[]> {
    // CowSwap supports same-chain EVM swaps
    // For now, return common trading pairs on supported chains
    // This can be enhanced to query their API for specific token lists
    const pairs: SwapperRoutePair[] = [];

    try {
      // CowSwap supported chains
      const supportedChains = [
        { chainId: 'eip155:1', name: 'ethereum' },        // Ethereum Mainnet
        { chainId: 'eip155:100', name: 'gnosis' },        // Gnosis Chain
        { chainId: 'eip155:42161', name: 'arbitrum' },    // Arbitrum
        { chainId: 'eip155:8453', name: 'base' },         // Base
      ];

      // Common tokens on each chain (native + major stables/tokens)
      const commonTokens: Record<string, Array<{ assetId: string; symbol: string }>> = {
        'eip155:1': [
          { assetId: 'eip155:1/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
          { assetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT' },
          { assetId: 'eip155:1/erc20:0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI' },
          { assetId: 'eip155:1/erc20:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC' },
        ],
        'eip155:100': [
          { assetId: 'eip155:100/slip44:60', symbol: 'xDAI' },
          { assetId: 'eip155:100/erc20:0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', symbol: 'USDC' },
        ],
        'eip155:42161': [
          { assetId: 'eip155:42161/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:42161/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC' },
          { assetId: 'eip155:42161/erc20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT' },
        ],
        'eip155:8453': [
          { assetId: 'eip155:8453/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
        ],
      };

      // Create same-chain pairs for each supported chain
      for (const chain of supportedChains) {
        const tokens = commonTokens[chain.chainId] || [];

        for (const sellToken of tokens) {
          for (const buyToken of tokens) {
            if (sellToken.assetId === buyToken.assetId) continue;

            pairs.push({
              swapperName: SwapperName.CowSwap,
              sellAssetId: sellToken.assetId,
              buyAssetId: buyToken.assetId,
              sellChainId: chain.chainId,
              buyChainId: chain.chainId,
            });
          }
        }
      }

      this.logger.log(`Created ${pairs.length} CowSwap route pairs for ${supportedChains.length} chains`);
    } catch (error) {
      this.logger.error('Failed to create CowSwap routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from 0x/ZRX
   * 0x supports EVM chain swaps across multiple networks
   */
  private async getZrxRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      // 0x supported chains
      const supportedChains = [
        { chainId: 'eip155:1', name: 'ethereum' },
        { chainId: 'eip155:137', name: 'polygon' },
        { chainId: 'eip155:56', name: 'bsc' },
        { chainId: 'eip155:42161', name: 'arbitrum' },
        { chainId: 'eip155:10', name: 'optimism' },
        { chainId: 'eip155:43114', name: 'avalanche' },
        { chainId: 'eip155:8453', name: 'base' },
      ];

      // Common tokens for 0x (similar structure to CowSwap)
      const commonTokens: Record<string, Array<{ assetId: string; symbol: string }>> = {
        'eip155:1': [
          { assetId: 'eip155:1/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
          { assetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT' },
        ],
        'eip155:137': [
          { assetId: 'eip155:137/slip44:966', symbol: 'MATIC' },
          { assetId: 'eip155:137/erc20:0x2791bca1f2de4661ed88a30c99a7a9449aa84174', symbol: 'USDC' },
        ],
        'eip155:42161': [
          { assetId: 'eip155:42161/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:42161/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC' },
        ],
        'eip155:8453': [
          { assetId: 'eip155:8453/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
        ],
      };

      // Create same-chain pairs for each supported chain
      for (const chain of supportedChains) {
        const tokens = commonTokens[chain.chainId] || [];

        for (const sellToken of tokens) {
          for (const buyToken of tokens) {
            if (sellToken.assetId === buyToken.assetId) continue;

            pairs.push({
              swapperName: SwapperName.Zrx,
              sellAssetId: sellToken.assetId,
              buyAssetId: buyToken.assetId,
              sellChainId: chain.chainId,
              buyChainId: chain.chainId,
            });
          }
        }
      }

      this.logger.log(`Created ${pairs.length} 0x route pairs for ${supportedChains.length} chains`);
    } catch (error) {
      this.logger.error('Failed to create 0x routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from Relay bridge
   * Relay supports cross-chain bridging between EVM chains
   */
  private async getRelayRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      const relayApiUrl = process.env.VITE_RELAY_API_URL || 'https://api.relay.link';
      const chainsUrl = `${relayApiUrl}/chains`;

      this.logger.debug(`Fetching Relay chains from ${chainsUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(chainsUrl, { timeout: 10000 }),
      );

      const chains = response.data?.chains || response.data || [];

      if (!Array.isArray(chains)) {
        this.logger.warn('Relay chains response is not an array');
        return pairs;
      }

      // For Relay, we create cross-chain routes for native assets
      // Each chain can bridge to other chains
      const relayChains = chains
        .filter((chain: any) => chain.enabled !== false)
        .map((chain: any) => ({
          chainId: `eip155:${chain.id}`,
          nativeAssetId: `eip155:${chain.id}/slip44:60`,
          name: chain.name,
        }));

      // Create cross-chain pairs for native assets
      for (const sourceChain of relayChains) {
        for (const destChain of relayChains) {
          if (sourceChain.chainId === destChain.chainId) continue;

          pairs.push({
            swapperName: SwapperName.Relay,
            sellAssetId: sourceChain.nativeAssetId,
            buyAssetId: destChain.nativeAssetId,
            sellChainId: sourceChain.chainId,
            buyChainId: destChain.chainId,
          });
        }
      }

      this.logger.log(`Created ${pairs.length} Relay route pairs from ${relayChains.length} chains`);
    } catch (error) {
      this.logger.error('Failed to fetch Relay routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from Portals aggregator
   * Portals supports EVM chain swaps with aggregation
   */
  private async getPortalsRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      // Portals supported chains (similar to other EVM aggregators)
      const supportedChains = [
        { chainId: 'eip155:1', name: 'ethereum' },
        { chainId: 'eip155:137', name: 'polygon' },
        { chainId: 'eip155:42161', name: 'arbitrum' },
        { chainId: 'eip155:10', name: 'optimism' },
        { chainId: 'eip155:8453', name: 'base' },
      ];

      // Common tokens for Portals
      const commonTokens: Record<string, Array<{ assetId: string; symbol: string }>> = {
        'eip155:1': [
          { assetId: 'eip155:1/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
          { assetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT' },
        ],
        'eip155:137': [
          { assetId: 'eip155:137/slip44:966', symbol: 'MATIC' },
          { assetId: 'eip155:137/erc20:0x2791bca1f2de4661ed88a30c99a7a9449aa84174', symbol: 'USDC' },
        ],
        'eip155:42161': [
          { assetId: 'eip155:42161/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:42161/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC' },
        ],
        'eip155:8453': [
          { assetId: 'eip155:8453/slip44:60', symbol: 'ETH' },
          { assetId: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
        ],
      };

      for (const chain of supportedChains) {
        const tokens = commonTokens[chain.chainId] || [];

        for (const sellToken of tokens) {
          for (const buyToken of tokens) {
            if (sellToken.assetId === buyToken.assetId) continue;

            pairs.push({
              swapperName: SwapperName.Portals,
              sellAssetId: sellToken.assetId,
              buyAssetId: buyToken.assetId,
              sellChainId: chain.chainId,
              buyChainId: chain.chainId,
            });
          }
        }
      }

      this.logger.log(`Created ${pairs.length} Portals route pairs`);
    } catch (error) {
      this.logger.error('Failed to create Portals routes', error);
    }

    return pairs;
  }

  /**
   * Get available routes from Jupiter (Solana DEX aggregator)
   */
  private async getJupiterRoutes(): Promise<SwapperRoutePair[]> {
    const pairs: SwapperRoutePair[] = [];

    try {
      const jupiterApiUrl = process.env.VITE_JUPITER_API_URL || 'https://quote-api.jup.ag';

      // Jupiter provides a tokens endpoint
      // For now, use common Solana tokens
      const solanaChainId = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

      const commonTokens = [
        { assetId: `${solanaChainId}/slip44:501`, symbol: 'SOL' },
        { assetId: `${solanaChainId}/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, symbol: 'USDC' },
        { assetId: `${solanaChainId}/spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, symbol: 'USDT' },
        { assetId: `${solanaChainId}/spl:So11111111111111111111111111111111111111112`, symbol: 'WSOL' },
      ];

      // Create pairs for all token combinations
      for (const sellToken of commonTokens) {
        for (const buyToken of commonTokens) {
          if (sellToken.assetId === buyToken.assetId) continue;

          pairs.push({
            swapperName: SwapperName.Jupiter,
            sellAssetId: sellToken.assetId,
            buyAssetId: buyToken.assetId,
            sellChainId: solanaChainId,
            buyChainId: solanaChainId,
          });
        }
      }

      this.logger.log(`Created ${pairs.length} Jupiter route pairs for Solana`);
    } catch (error) {
      this.logger.error('Failed to create Jupiter routes', error);
    }

    return pairs;
  }

  /**
   * Convert Thorchain pool asset notation to CAIP asset ID
   * @param poolAsset e.g., "BTC.BTC", "ETH.ETH", "ETH.USDC-0xA0b..."
   */
  private thorchainAssetToAssetId(poolAsset: string): string | null {
    const assetMappings: Record<string, string> = {
      'BTC.BTC': 'bip122:000000000019d6689c085ae165831e93/slip44:0',
      'ETH.ETH': 'eip155:1/slip44:60',
      'LTC.LTC': 'bip122:12a765e31ffd4059bada1e25190f6e98/slip44:2',
      'BCH.BCH': 'bip122:000000000000000000651ef99cb9fcbe/slip44:145',
      'DOGE.DOGE': 'bip122:1a91e3dace36e2be3bf030a65679fe82/slip44:3',
      'GAIA.ATOM': 'cosmos:cosmoshub-4/slip44:118',
      'AVAX.AVAX': 'eip155:43114/slip44:60',
      'BSC.BNB': 'eip155:56/slip44:60',
    };

    // Check direct mapping
    if (assetMappings[poolAsset]) {
      return assetMappings[poolAsset];
    }

    // Handle ERC20 tokens (e.g., ETH.USDC-0xA0b...)
    if (poolAsset.startsWith('ETH.') && poolAsset.includes('-')) {
      const parts = poolAsset.split('-');
      if (parts.length >= 2) {
        const contractAddress = parts[1].toLowerCase();
        return `eip155:1/erc20:${contractAddress}`;
      }
    }

    // Handle AVAX tokens
    if (poolAsset.startsWith('AVAX.') && poolAsset.includes('-')) {
      const parts = poolAsset.split('-');
      if (parts.length >= 2) {
        const contractAddress = parts[1].toLowerCase();
        return `eip155:43114/erc20:${contractAddress}`;
      }
    }

    // Handle BSC tokens
    if (poolAsset.startsWith('BSC.') && poolAsset.includes('-')) {
      const parts = poolAsset.split('-');
      if (parts.length >= 2) {
        const contractAddress = parts[1].toLowerCase();
        return `eip155:56/erc20:${contractAddress}`;
      }
    }

    return null;
  }

  /**
   * Convert Thorchain pool asset notation to chain ID
   */
  private thorchainAssetToChainId(poolAsset: string): string | null {
    const chainMappings: Record<string, string> = {
      'BTC': 'bip122:000000000019d6689c085ae165831e93',
      'ETH': 'eip155:1',
      'LTC': 'bip122:12a765e31ffd4059bada1e25190f6e98',
      'BCH': 'bip122:000000000000000000651ef99cb9fcbe',
      'DOGE': 'bip122:1a91e3dace36e2be3bf030a65679fe82',
      'GAIA': 'cosmos:cosmoshub-4',
      'AVAX': 'eip155:43114',
      'BSC': 'eip155:56',
    };

    const chain = poolAsset.split('.')[0];
    return chainMappings[chain] || null;
  }

  /**
   * Convert Mayachain pool asset notation to CAIP asset ID
   */
  private mayachainAssetToAssetId(poolAsset: string): string | null {
    // Mayachain uses similar notation to Thorchain
    return this.thorchainAssetToAssetId(poolAsset);
  }

  /**
   * Convert Mayachain pool asset notation to chain ID
   */
  private mayachainAssetToChainId(poolAsset: string): string | null {
    return this.thorchainAssetToChainId(poolAsset);
  }

  /**
   * Convert Chainflip asset to CAIP asset ID
   */
  private chainflipAssetToAssetId(asset: any): string | null {
    const symbol = (asset.symbol || asset.asset || '').toUpperCase();
    const chain = (asset.chain || '').toLowerCase();

    const assetMappings: Record<string, string> = {
      'BTC': 'bip122:000000000019d6689c085ae165831e93/slip44:0',
      'ETH': 'eip155:1/slip44:60',
      'USDC': 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      'USDT': 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
      'DOT': 'polkadot:91b171bb158e2d3848fa23a9f1c25182/slip44:354',
      'FLIP': 'eip155:1/erc20:0x826180541412d574cf1336d22c0c0a287822678a',
    };

    return assetMappings[symbol] || null;
  }

  /**
   * Convert Chainflip asset to chain ID
   */
  private chainflipAssetToChainId(asset: any): string | null {
    const symbol = (asset.symbol || asset.asset || '').toUpperCase();
    const chain = (asset.chain || '').toLowerCase();

    const chainMappings: Record<string, string> = {
      'BTC': 'bip122:000000000019d6689c085ae165831e93',
      'ETH': 'eip155:1',
      'USDC': 'eip155:1',
      'USDT': 'eip155:1',
      'DOT': 'polkadot:91b171bb158e2d3848fa23a9f1c25182',
      'FLIP': 'eip155:1',
    };

    // Try by symbol first, then by chain
    if (chainMappings[symbol]) {
      return chainMappings[symbol];
    }

    if (chain === 'ethereum') return 'eip155:1';
    if (chain === 'bitcoin') return 'bip122:000000000019d6689c085ae165831e93';
    if (chain === 'polkadot') return 'polkadot:91b171bb158e2d3848fa23a9f1c25182';

    return null;
  }

  /**
   * Check if the graph has any routes from a sell asset
   * @param sellAssetId Source asset identifier
   * @returns true if there are outgoing edges from this asset
   */
  hasRoutesFrom(sellAssetId: string): boolean {
    const node = this.graph.getNode(sellAssetId);
    if (!node) return false;

    let hasOutgoing = false;
    this.graph.forEachLinkedNode(
      sellAssetId,
      (_linkedNode, link) => {
        if (link.fromId === sellAssetId) {
          hasOutgoing = true;
        }
      },
      true, // Include outgoing links
    );

    return hasOutgoing;
  }

  /**
   * Check if the graph has any routes to a buy asset
   * @param buyAssetId Destination asset identifier
   * @returns true if there are incoming edges to this asset
   */
  hasRoutesTo(buyAssetId: string): boolean {
    const node = this.graph.getNode(buyAssetId);
    if (!node) return false;

    let hasIncoming = false;
    this.graph.forEachLinkedNode(
      buyAssetId,
      (_linkedNode, link) => {
        if (link.toId === buyAssetId) {
          hasIncoming = true;
        }
      },
      true,
    );

    return hasIncoming;
  }

  /**
   * Get all direct routes between two assets
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @returns Array of edge data for direct routes
   */
  getDirectRoutes(sellAssetId: string, buyAssetId: string): RouteEdgeData[] {
    const routes: RouteEdgeData[] = [];

    this.graph.forEachLinkedNode(
      sellAssetId,
      (_linkedNode, link) => {
        if (link.toId === buyAssetId && link.data) {
          routes.push(link.data);
        }
      },
      true,
    );

    return routes;
  }

  /**
   * Get all outgoing routes from an asset
   * @param assetId Source asset identifier
   * @returns Array of edge data for all outgoing routes
   */
  getOutgoingRoutes(assetId: string): RouteEdgeData[] {
    const routes: RouteEdgeData[] = [];

    this.graph.forEachLinkedNode(
      assetId,
      (_linkedNode, link) => {
        if (link.fromId === assetId && link.data) {
          routes.push(link.data);
        }
      },
      true,
    );

    return routes;
  }

  /**
   * Check if an asset node exists in the graph
   * @param assetId Asset identifier to check
   * @returns true if the asset exists in the graph
   */
  hasAsset(assetId: string): boolean {
    return this.graph.hasNode(assetId);
  }

  /**
   * Refresh the route graph by rebuilding it
   * This can be called periodically or when swapper configurations change
   */
  async refreshGraph(): Promise<void> {
    this.logger.log('Refreshing route graph...');
    await this.buildGraph();
  }

  /**
   * Check if an edge with a specific swapper already exists
   */
  private hasEdgeWithSwapper(
    sellAssetId: string,
    buyAssetId: string,
    swapperName: SwapperName,
  ): boolean {
    let found = false;

    this.graph.forEachLinkedNode(
      sellAssetId,
      (_linkedNode, link) => {
        if (link.toId === buyAssetId && link.data?.swapperName === swapperName) {
          found = true;
        }
      },
      true,
    );

    return found;
  }
}
