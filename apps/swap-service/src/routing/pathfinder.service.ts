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
 * Cross-chain hop penalty for distance calculation.
 * This makes the pathfinder prefer same-chain routes over cross-chain routes
 * when multiple paths exist.
 */
const CROSS_CHAIN_HOP_PENALTY = 2;

/**
 * Cache key prefix for pathfinding results
 */
const PATH_CACHE_PREFIX = 'path:';

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

      // Generate cache key for this path request
      const cacheKey = this.generatePathCacheKey(sellAssetId, buyAssetId, effectiveConstraints);

      // Check cache first
      const cachedPath = this.cacheService.get<FoundPath>(cacheKey);
      if (cachedPath) {
        const duration = Date.now() - startTime;
        this.logger.debug(`Path found (cached) in ${duration}ms`);
        return {
          path: cachedPath,
          success: true,
        };
      }

      // Check for direct route first (optimization)
      const directRoutes = this.routeGraphService.getDirectRoutes(sellAssetId, buyAssetId);
      if (directRoutes.length > 0) {
        // Find the best direct route based on constraints
        const validDirectRoute = this.findBestDirectRoute(directRoutes, effectiveConstraints);

        if (validDirectRoute) {
          const foundPath: FoundPath = {
            assetIds: [sellAssetId, buyAssetId],
            edges: [validDirectRoute],
            hopCount: 1,
            crossChainHopCount: validDirectRoute.isCrossChain ? 1 : 0,
          };

          // Cache the result
          this.cacheService.set(cacheKey, foundPath);

          const duration = Date.now() - startTime;
          this.logger.log(`Path found (direct) in ${duration}ms`);

          return {
            path: foundPath,
            success: true,
          };
        }
        // If no valid direct route, continue to multi-hop pathfinding
        this.logger.debug('Direct routes exist but none match constraints, trying multi-hop');
      }

      // Use ngraph.path for multi-hop pathfinding with constraint-aware distance function
      const pathFinder = path.nba(graph, {
        // Custom distance function that penalizes cross-chain hops
        // This makes the algorithm prefer same-chain routes when multiple paths exist
        distance: (_fromNode, _toNode, link) => {
          const edgeData = link.data as RouteEdgeData | undefined;
          if (!edgeData) return 1;

          // Apply penalty for cross-chain hops to prefer same-chain routes
          const baseCost = 1;
          const crossChainPenalty = edgeData.isCrossChain ? CROSS_CHAIN_HOP_PENALTY : 0;

          // Apply higher penalty for excluded swappers (effectively blocking them)
          if (effectiveConstraints.excludedSwapperNames?.includes(edgeData.swapperName)) {
            return Infinity; // Block this edge
          }

          // If allowed swappers are specified, block others
          if (
            effectiveConstraints.allowedSwapperNames?.length &&
            !effectiveConstraints.allowedSwapperNames.includes(edgeData.swapperName)
          ) {
            return Infinity; // Block this edge
          }

          return baseCost + crossChainPenalty;
        },
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

      const result: FoundPath = {
        assetIds,
        edges,
        hopCount,
        crossChainHopCount,
      };

      // Cache the successful path result
      this.cacheService.set(cacheKey, result);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Path found in ${duration}ms: ${assetIds.join(' -> ')} (${hopCount} hops, ${crossChainHopCount} cross-chain)`,
      );

      return {
        path: result,
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

  /**
   * Generate a cache key for a path request.
   *
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @param constraints Route constraints
   * @returns Cache key string
   */
  private generatePathCacheKey(
    sellAssetId: string,
    buyAssetId: string,
    constraints: RouteConstraints,
  ): string {
    // Include constraints in the cache key to differentiate cached results
    const constraintParts = [
      `h${constraints.maxHops}`,
      `x${constraints.maxCrossChainHops}`,
    ];

    if (constraints.allowedSwapperNames?.length) {
      constraintParts.push(`a${constraints.allowedSwapperNames.sort().join(',')}`);
    }

    if (constraints.excludedSwapperNames?.length) {
      constraintParts.push(`e${constraints.excludedSwapperNames.sort().join(',')}`);
    }

    return `${PATH_CACHE_PREFIX}${sellAssetId}:${buyAssetId}:${constraintParts.join(':')}`;
  }

  /**
   * Find the best direct route that matches the given constraints.
   *
   * @param routes Array of available direct routes
   * @param constraints Route constraints to apply
   * @returns The best matching route or null if none match
   */
  private findBestDirectRoute(
    routes: RouteEdgeData[],
    constraints: RouteConstraints,
  ): RouteEdgeData | null {
    // Filter routes based on constraints
    const validRoutes = routes.filter((route) => {
      // Check cross-chain constraint
      if (route.isCrossChain && constraints.maxCrossChainHops < 1) {
        return false;
      }

      // Check allowed swappers
      if (
        constraints.allowedSwapperNames?.length &&
        !constraints.allowedSwapperNames.includes(route.swapperName)
      ) {
        return false;
      }

      // Check excluded swappers
      if (constraints.excludedSwapperNames?.includes(route.swapperName)) {
        return false;
      }

      return true;
    });

    if (validRoutes.length === 0) {
      return null;
    }

    // Prefer same-chain routes over cross-chain routes
    const sameChainRoutes = validRoutes.filter((r) => !r.isCrossChain);
    if (sameChainRoutes.length > 0) {
      return sameChainRoutes[0];
    }

    // Return first cross-chain route if no same-chain routes exist
    return validRoutes[0];
  }

  /**
   * Validate a path against constraints.
   * Returns a detailed validation result.
   *
   * @param assetIds Ordered list of asset IDs in the path
   * @param edges Edge data for each hop
   * @param constraints Route constraints to validate against
   * @returns Validation result with error message if invalid
   */
  validatePathConstraints(
    assetIds: string[],
    edges: RouteEdgeData[],
    constraints: RouteConstraints,
  ): { valid: boolean; error?: string } {
    // Check for circular routes
    if (this.hasCircularRoute(assetIds)) {
      return {
        valid: false,
        error: 'Circular route detected - path would revisit an asset',
      };
    }

    // Check hop count
    const hopCount = edges.length;
    if (hopCount > constraints.maxHops) {
      return {
        valid: false,
        error: `Path requires ${hopCount} hops, exceeds maximum of ${constraints.maxHops}`,
      };
    }

    // Check cross-chain hop count
    const crossChainHopCount = edges.filter((e) => e.isCrossChain).length;
    if (crossChainHopCount > constraints.maxCrossChainHops) {
      return {
        valid: false,
        error: `Path requires ${crossChainHopCount} cross-chain hops, exceeds maximum of ${constraints.maxCrossChainHops}`,
      };
    }

    // Check allowed swappers
    if (constraints.allowedSwapperNames?.length) {
      const disallowedSwapper = edges.find(
        (e) => !constraints.allowedSwapperNames!.includes(e.swapperName),
      );
      if (disallowedSwapper) {
        return {
          valid: false,
          error: `Path uses swapper not in allowed list: ${disallowedSwapper.swapperName}`,
        };
      }
    }

    // Check excluded swappers
    if (constraints.excludedSwapperNames?.length) {
      const excludedSwapper = edges.find((e) =>
        constraints.excludedSwapperNames!.includes(e.swapperName),
      );
      if (excludedSwapper) {
        return {
          valid: false,
          error: `Path uses excluded swapper: ${excludedSwapper.swapperName}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Get the effective constraints by merging user-provided constraints with defaults.
   *
   * @param userConstraints Optional user-provided constraints
   * @returns Complete RouteConstraints object
   */
  getEffectiveConstraints(userConstraints?: Partial<RouteConstraints>): RouteConstraints {
    return { ...DEFAULT_CONSTRAINTS, ...userConstraints };
  }

  /**
   * Clear cached paths. Useful when the route graph is rebuilt.
   */
  clearPathCache(): void {
    // The cache service handles clearing - this is a convenience method
    // that documents the capability for other services
    this.logger.debug('Path cache will be cleared on next graph rebuild');
  }

  /**
   * Find alternative routes between two assets.
   *
   * Uses an iterative approach to find diverse alternative paths by temporarily
   * blocking edges from previously found paths and re-running pathfinding.
   *
   * @param sellAssetId Source asset identifier (CAIP format)
   * @param buyAssetId Destination asset identifier (CAIP format)
   * @param constraints Optional route constraints
   * @param maxAlternatives Maximum number of alternatives to find (default: 3)
   * @returns Array of alternative paths (excluding the primary path)
   */
  async findAlternativeRoutes(
    sellAssetId: string,
    buyAssetId: string,
    constraints?: Partial<RouteConstraints>,
    maxAlternatives: number = 3,
  ): Promise<FoundPath[]> {
    const startTime = Date.now();
    const effectiveConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };

    this.logger.log(
      `Finding alternative routes: ${sellAssetId} -> ${buyAssetId} (max: ${maxAlternatives})`,
    );

    // First, find the primary path
    const primaryResult = await this.findPath(sellAssetId, buyAssetId, constraints);

    if (!primaryResult.success || !primaryResult.path) {
      this.logger.debug('No primary path found, no alternatives possible');
      return [];
    }

    const alternatives: FoundPath[] = [];
    const seenPathSignatures = new Set<string>();

    // Create a signature for the primary path to avoid duplicates
    seenPathSignatures.add(this.getPathSignature(primaryResult.path));

    // Collect edges to block from the primary path
    const edgesToBlock: Array<{ from: string; to: string; swapperName: string }> = [];
    for (let i = 0; i < primaryResult.path.edges.length; i++) {
      edgesToBlock.push({
        from: primaryResult.path.assetIds[i],
        to: primaryResult.path.assetIds[i + 1],
        swapperName: primaryResult.path.edges[i].swapperName,
      });
    }

    // Try to find alternatives by blocking each edge from the primary path
    for (const edgeToBlock of edgesToBlock) {
      if (alternatives.length >= maxAlternatives) {
        break;
      }

      const altPath = await this.findPathWithBlockedEdges(
        sellAssetId,
        buyAssetId,
        effectiveConstraints,
        [edgeToBlock],
      );

      if (altPath) {
        const signature = this.getPathSignature(altPath);
        if (!seenPathSignatures.has(signature)) {
          seenPathSignatures.add(signature);
          alternatives.push(altPath);
          this.logger.debug(
            `Found alternative ${alternatives.length}: ${altPath.assetIds.join(' -> ')}`,
          );
        }
      }
    }

    // If we still need more alternatives, try blocking combinations of edges
    if (alternatives.length < maxAlternatives && alternatives.length > 0) {
      // Block edges from found alternatives to discover more diverse routes
      for (const altPath of [...alternatives]) {
        if (alternatives.length >= maxAlternatives) {
          break;
        }

        const altEdgesToBlock: Array<{ from: string; to: string; swapperName: string }> = [];
        for (let i = 0; i < altPath.edges.length; i++) {
          altEdgesToBlock.push({
            from: altPath.assetIds[i],
            to: altPath.assetIds[i + 1],
            swapperName: altPath.edges[i].swapperName,
          });
        }

        for (const edgeToBlock of altEdgesToBlock) {
          if (alternatives.length >= maxAlternatives) {
            break;
          }

          const newAltPath = await this.findPathWithBlockedEdges(
            sellAssetId,
            buyAssetId,
            effectiveConstraints,
            [edgeToBlock],
          );

          if (newAltPath) {
            const signature = this.getPathSignature(newAltPath);
            if (!seenPathSignatures.has(signature)) {
              seenPathSignatures.add(signature);
              alternatives.push(newAltPath);
              this.logger.debug(
                `Found alternative ${alternatives.length}: ${newAltPath.assetIds.join(' -> ')}`,
              );
            }
          }
        }
      }
    }

    // Sort alternatives by preference: fewer hops first, then fewer cross-chain hops
    alternatives.sort((a, b) => {
      if (a.hopCount !== b.hopCount) {
        return a.hopCount - b.hopCount;
      }
      return a.crossChainHopCount - b.crossChainHopCount;
    });

    const duration = Date.now() - startTime;
    this.logger.log(
      `Found ${alternatives.length} alternative routes in ${duration}ms`,
    );

    return alternatives.slice(0, maxAlternatives);
  }

  /**
   * Find a path with specific edges blocked.
   *
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @param constraints Route constraints
   * @param blockedEdges Edges to block during pathfinding
   * @returns Found path or null if no path exists
   */
  private async findPathWithBlockedEdges(
    sellAssetId: string,
    buyAssetId: string,
    constraints: RouteConstraints,
    blockedEdges: Array<{ from: string; to: string; swapperName: string }>,
  ): Promise<FoundPath | null> {
    const graph = this.routeGraphService.getGraph();

    // Create a set of blocked edge keys for fast lookup
    const blockedEdgeKeys = new Set(
      blockedEdges.map((e) => `${e.from}:${e.to}:${e.swapperName}`),
    );

    const pathFinder = path.nba(graph, {
      distance: (_fromNode, _toNode, link) => {
        const edgeData = link.data as RouteEdgeData | undefined;
        if (!edgeData) return 1;

        // Block the specified edges
        const edgeKey = `${link.fromId}:${link.toId}:${edgeData.swapperName}`;
        if (blockedEdgeKeys.has(edgeKey)) {
          return Infinity;
        }

        // Apply penalty for cross-chain hops
        const baseCost = 1;
        const crossChainPenalty = edgeData.isCrossChain ? CROSS_CHAIN_HOP_PENALTY : 0;

        // Apply higher penalty for excluded swappers
        if (constraints.excludedSwapperNames?.includes(edgeData.swapperName)) {
          return Infinity;
        }

        // If allowed swappers are specified, block others
        if (
          constraints.allowedSwapperNames?.length &&
          !constraints.allowedSwapperNames.includes(edgeData.swapperName)
        ) {
          return Infinity;
        }

        return baseCost + crossChainPenalty;
      },
    });

    const foundPath = pathFinder.find(sellAssetId, buyAssetId);

    if (!foundPath || foundPath.length === 0) {
      return null;
    }

    // Convert ngraph path to our format
    const assetIds = foundPath.map((node) => node.id as string);
    const edges = this.extractEdgesFromPath(assetIds);

    // Check for circular routes
    if (this.hasCircularRoute(assetIds)) {
      return null;
    }

    // Calculate hop counts
    const hopCount = edges.length;
    const crossChainHopCount = edges.filter((e) => e.isCrossChain).length;

    // Validate against constraints
    if (hopCount > constraints.maxHops) {
      return null;
    }

    if (crossChainHopCount > constraints.maxCrossChainHops) {
      return null;
    }

    // Check allowed/excluded swappers
    if (constraints.allowedSwapperNames?.length) {
      const disallowedSwapper = edges.find(
        (e) => !constraints.allowedSwapperNames!.includes(e.swapperName),
      );
      if (disallowedSwapper) {
        return null;
      }
    }

    if (constraints.excludedSwapperNames?.length) {
      const excludedSwapper = edges.find((e) =>
        constraints.excludedSwapperNames!.includes(e.swapperName),
      );
      if (excludedSwapper) {
        return null;
      }
    }

    return {
      assetIds,
      edges,
      hopCount,
      crossChainHopCount,
    };
  }

  /**
   * Generate a unique signature for a path.
   * Used to detect duplicate paths when finding alternatives.
   *
   * @param foundPath The path to generate a signature for
   * @returns A string signature representing the path
   */
  private getPathSignature(foundPath: FoundPath): string {
    // Create a signature based on asset IDs and swapper names
    // This ensures two paths with the same assets but different swappers are treated as different
    const edgeSignatures = foundPath.edges.map((e) => e.swapperName);
    return `${foundPath.assetIds.join('->')}_${edgeSignatures.join(',')}`;
  }
}
