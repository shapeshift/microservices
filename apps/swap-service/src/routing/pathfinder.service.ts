import { Injectable, Logger } from '@nestjs/common';
import { RouteGraphService, RouteEdgeData } from './route-graph.service';
import { RouteCacheService } from './route-cache.service';
import { RouteConstraints } from '@shapeshift/shared-types';
import path from 'ngraph.path';

/**
 * A discovered path through the route graph
 */
export interface FoundPath {
  /** Ordered list of asset IDs in the path (including start and end) */
  assetIds: string[];
  /** Edge data for each hop in the path */
  edges: RouteEdgeData[];
  /** Total number of hops */
  hopCount: number;
  /** Number of cross-chain hops */
  crossChainHopCount: number;
}

/**
 * Result of pathfinding operation
 */
export interface PathfindingResult {
  /** The found path, or null if no path exists */
  path: FoundPath | null;
  /** Whether a valid path was found */
  success: boolean;
  /** Error message if pathfinding failed */
  error?: string;
}

/**
 * Default route constraints
 */
const DEFAULT_CONSTRAINTS: RouteConstraints = {
  maxHops: 4,
  maxCrossChainHops: 2,
};

/**
 * PathfinderService - Finds optimal multi-hop routes using NBA* pathfinding algorithm.
 *
 * This service:
 * - Uses ngraph.path for efficient pathfinding on the route graph
 * - Enforces configurable constraints (max hops, max cross-chain hops)
 * - Detects and prevents circular routes
 * - Provides alternative route discovery
 *
 * The NBA* (Navigational Bidirectional A*) algorithm is used for optimal
 * pathfinding performance on large graphs.
 */
@Injectable()
export class PathfinderService {
  private readonly logger = new Logger(PathfinderService.name);

  constructor(
    private readonly routeGraphService: RouteGraphService,
    private readonly cacheService: RouteCacheService,
  ) {
    this.logger.log('PathfinderService initialized');
  }

  /**
   * Find the optimal path between two assets.
   *
   * Uses NBA* algorithm to find the shortest path, then validates against constraints.
   *
   * @param sellAssetId Source asset identifier (CAIP format)
   * @param buyAssetId Destination asset identifier (CAIP format)
   * @param constraints Optional route constraints
   * @returns PathfindingResult with the found path or error
   */
  async findPath(
    sellAssetId: string,
    buyAssetId: string,
    constraints?: Partial<RouteConstraints>,
  ): Promise<PathfindingResult> {
    const startTime = Date.now();
    const effectiveConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };

    try {
      this.logger.log(
        `Finding path: ${sellAssetId} -> ${buyAssetId} (maxHops: ${effectiveConstraints.maxHops}, maxCrossChain: ${effectiveConstraints.maxCrossChainHops})`,
      );

      // Check if both assets exist in the graph
      const graph = this.routeGraphService.getGraph();

      if (!this.routeGraphService.hasAsset(sellAssetId)) {
        this.logger.warn(`Sell asset not found in graph: ${sellAssetId}`);
        return {
          path: null,
          success: false,
          error: `Sell asset not found: ${sellAssetId}`,
        };
      }

      if (!this.routeGraphService.hasAsset(buyAssetId)) {
        this.logger.warn(`Buy asset not found in graph: ${buyAssetId}`);
        return {
          path: null,
          success: false,
          error: `Buy asset not found: ${buyAssetId}`,
        };
      }

      // Check for direct route first (optimization)
      const directRoutes = this.routeGraphService.getDirectRoutes(sellAssetId, buyAssetId);
      if (directRoutes.length > 0) {
        this.logger.debug(`Found ${directRoutes.length} direct route(s)`);
        const duration = Date.now() - startTime;
        this.logger.log(`Path found (direct) in ${duration}ms`);

        return {
          path: {
            assetIds: [sellAssetId, buyAssetId],
            edges: [directRoutes[0]], // Use first direct route
            hopCount: 1,
            crossChainHopCount: directRoutes[0].isCrossChain ? 1 : 0,
          },
          success: true,
        };
      }

      // Use ngraph.path for multi-hop pathfinding
      const pathFinder = path.nba(graph, {
        // Custom distance function - all edges have equal weight initially
        // Can be enhanced to use liquidity, fees, etc.
        distance: (_fromNode, _toNode, _link) => 1,
      });

      const foundPath = pathFinder.find(sellAssetId, buyAssetId);

      if (!foundPath || foundPath.length === 0) {
        this.logger.warn(`No path found: ${sellAssetId} -> ${buyAssetId}`);
        return {
          path: null,
          success: false,
          error: `No route available from ${sellAssetId} to ${buyAssetId}`,
        };
      }

      // Convert ngraph path to our format
      const assetIds = foundPath.map((node) => node.id as string);
      const edges = this.extractEdgesFromPath(assetIds);

      // Check for circular routes
      if (this.hasCircularRoute(assetIds)) {
        this.logger.warn(`Circular route detected: ${assetIds.join(' -> ')}`);
        return {
          path: null,
          success: false,
          error: 'Circular route detected - path would revisit an asset',
        };
      }

      // Calculate hop counts
      const hopCount = edges.length;
      const crossChainHopCount = edges.filter((e) => e.isCrossChain).length;

      // Validate against constraints
      if (hopCount > effectiveConstraints.maxHops) {
        this.logger.warn(
          `Path exceeds max hops: ${hopCount} > ${effectiveConstraints.maxHops}`,
        );
        return {
          path: null,
          success: false,
          error: `Path requires ${hopCount} hops, exceeds maximum of ${effectiveConstraints.maxHops}`,
        };
      }

      if (crossChainHopCount > effectiveConstraints.maxCrossChainHops) {
        this.logger.warn(
          `Path exceeds max cross-chain hops: ${crossChainHopCount} > ${effectiveConstraints.maxCrossChainHops}`,
        );
        return {
          path: null,
          success: false,
          error: `Path requires ${crossChainHopCount} cross-chain hops, exceeds maximum of ${effectiveConstraints.maxCrossChainHops}`,
        };
      }

      // Filter by allowed/excluded swappers if specified
      if (effectiveConstraints.allowedSwapperNames?.length) {
        const disallowedSwapper = edges.find(
          (e) => !effectiveConstraints.allowedSwapperNames!.includes(e.swapperName),
        );
        if (disallowedSwapper) {
          this.logger.warn(
            `Path uses disallowed swapper: ${disallowedSwapper.swapperName}`,
          );
          return {
            path: null,
            success: false,
            error: `Path uses swapper not in allowed list: ${disallowedSwapper.swapperName}`,
          };
        }
      }

      if (effectiveConstraints.excludedSwapperNames?.length) {
        const excludedSwapper = edges.find((e) =>
          effectiveConstraints.excludedSwapperNames!.includes(e.swapperName),
        );
        if (excludedSwapper) {
          this.logger.warn(`Path uses excluded swapper: ${excludedSwapper.swapperName}`);
          return {
            path: null,
            success: false,
            error: `Path uses excluded swapper: ${excludedSwapper.swapperName}`,
          };
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Path found in ${duration}ms: ${assetIds.join(' -> ')} (${hopCount} hops, ${crossChainHopCount} cross-chain)`,
      );

      return {
        path: {
          assetIds,
          edges,
          hopCount,
          crossChainHopCount,
        },
        success: true,
      };
    } catch (error) {
      this.logger.error(`Pathfinding failed: ${sellAssetId} -> ${buyAssetId}`, error);
      return {
        path: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown pathfinding error',
      };
    }
  }

  /**
   * Extract edge data from a path of asset IDs.
   *
   * @param assetIds Ordered list of asset IDs in the path
   * @returns Array of edge data for each hop
   */
  private extractEdgesFromPath(assetIds: string[]): RouteEdgeData[] {
    const edges: RouteEdgeData[] = [];

    for (let i = 0; i < assetIds.length - 1; i++) {
      const sellAssetId = assetIds[i];
      const buyAssetId = assetIds[i + 1];

      const directRoutes = this.routeGraphService.getDirectRoutes(sellAssetId, buyAssetId);
      if (directRoutes.length > 0) {
        // Use the first available route for now
        // Can be enhanced to select best route based on other criteria
        edges.push(directRoutes[0]);
      } else {
        // This shouldn't happen if the pathfinder found a valid path
        this.logger.error(`No edge found for hop: ${sellAssetId} -> ${buyAssetId}`);
      }
    }

    return edges;
  }

  /**
   * Check if a path contains a circular route (revisits an asset).
   *
   * @param assetIds Ordered list of asset IDs in the path
   * @returns true if the path contains a circular route
   */
  private hasCircularRoute(assetIds: string[]): boolean {
    const seen = new Set<string>();

    for (const assetId of assetIds) {
      if (seen.has(assetId)) {
        return true;
      }
      seen.add(assetId);
    }

    return false;
  }
}
