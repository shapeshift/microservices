import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  constructor(private readonly cacheService: RouteCacheService) {
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
   * This is a placeholder that will be implemented in subtask-5-2.
   *
   * @returns Array of supported swap route pairs
   */
  async getAvailableRoutes(): Promise<SwapperRoutePair[]> {
    // TODO: Implement in subtask-5-2
    // This method will query each swapper for their supported asset pairs
    // For now, return empty array as placeholder
    this.logger.debug('getAvailableRoutes called - returning empty array (placeholder)');
    return [];
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
