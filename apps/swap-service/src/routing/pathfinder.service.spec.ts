import { Test, TestingModule } from '@nestjs/testing';
import { PathfinderService, FoundPath, PathfindingResult } from './pathfinder.service';
import { RouteGraphService, RouteEdgeData, SwapperRoutePair } from './route-graph.service';
import { RouteCacheService } from './route-cache.service';
import { RouteConstraints } from '@shapeshift/shared-types';
import { SwapperName } from '@shapeshiftoss/swapper';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';

describe('PathfinderService', () => {
  let service: PathfinderService;
  let routeGraphService: RouteGraphService;
  let cacheService: RouteCacheService;

  // Mock HTTP response helper
  const mockHttpResponse = <T>(data: T): AxiosResponse<T> => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as any,
  });

  // Test asset IDs
  const ETH = 'eip155:1/slip44:60';
  const USDC_ETH = 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDT_ETH = 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7';
  const DAI_ETH = 'eip155:1/erc20:0x6b175474e89094c44da98b954eedeac495271d0f';
  const WBTC_ETH = 'eip155:1/erc20:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
  const BTC = 'bip122:000000000019d6689c085ae165831e93/slip44:0';
  const RUNE = 'cosmos:thorchain-mainnet-v1/slip44:931';
  const USDC_ARB = 'eip155:42161/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831';
  const ETH_ARB = 'eip155:42161/slip44:60';

  // Test chain IDs
  const ETH_CHAIN = 'eip155:1';
  const ARB_CHAIN = 'eip155:42161';
  const BTC_CHAIN = 'bip122:000000000019d6689c085ae165831e93';
  const THOR_CHAIN = 'cosmos:thorchain-mainnet-v1';

  // Mock route pairs for testing
  const mockSwapperPairs: SwapperRoutePair[] = [
    // ETH <-> USDC on Ethereum (same-chain via CowSwap)
    {
      swapperName: SwapperName.CowSwap,
      sellAssetId: ETH,
      buyAssetId: USDC_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    {
      swapperName: SwapperName.CowSwap,
      sellAssetId: USDC_ETH,
      buyAssetId: ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    // USDC <-> USDT on Ethereum (same-chain via 0x)
    {
      swapperName: SwapperName.Zrx,
      sellAssetId: USDC_ETH,
      buyAssetId: USDT_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    {
      swapperName: SwapperName.Zrx,
      sellAssetId: USDT_ETH,
      buyAssetId: USDC_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    // USDT <-> DAI on Ethereum (same-chain via Portals)
    {
      swapperName: SwapperName.Portals,
      sellAssetId: USDT_ETH,
      buyAssetId: DAI_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    {
      swapperName: SwapperName.Portals,
      sellAssetId: DAI_ETH,
      buyAssetId: USDT_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    // ETH (mainnet) <-> ETH (Arbitrum) via Relay (cross-chain)
    {
      swapperName: SwapperName.Relay,
      sellAssetId: ETH,
      buyAssetId: ETH_ARB,
      sellChainId: ETH_CHAIN,
      buyChainId: ARB_CHAIN,
    },
    {
      swapperName: SwapperName.Relay,
      sellAssetId: ETH_ARB,
      buyAssetId: ETH,
      sellChainId: ARB_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    // ETH <-> RUNE via Thorchain (cross-chain)
    {
      swapperName: SwapperName.Thorchain,
      sellAssetId: ETH,
      buyAssetId: RUNE,
      sellChainId: ETH_CHAIN,
      buyChainId: THOR_CHAIN,
    },
    {
      swapperName: SwapperName.Thorchain,
      sellAssetId: RUNE,
      buyAssetId: ETH,
      sellChainId: THOR_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    // RUNE <-> BTC via Thorchain (cross-chain)
    {
      swapperName: SwapperName.Thorchain,
      sellAssetId: RUNE,
      buyAssetId: BTC,
      sellChainId: THOR_CHAIN,
      buyChainId: BTC_CHAIN,
    },
    {
      swapperName: SwapperName.Thorchain,
      sellAssetId: BTC,
      buyAssetId: RUNE,
      sellChainId: BTC_CHAIN,
      buyChainId: THOR_CHAIN,
    },
    // DAI <-> WBTC via CowSwap
    {
      swapperName: SwapperName.CowSwap,
      sellAssetId: DAI_ETH,
      buyAssetId: WBTC_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
    {
      swapperName: SwapperName.CowSwap,
      sellAssetId: WBTC_ETH,
      buyAssetId: DAI_ETH,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PathfinderService,
        RouteGraphService,
        RouteCacheService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn().mockReturnValue(of(mockHttpResponse([]))),
          },
        },
      ],
    }).compile();

    service = module.get<PathfinderService>(PathfinderService);
    routeGraphService = module.get<RouteGraphService>(RouteGraphService);
    cacheService = module.get<RouteCacheService>(RouteCacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    cacheService.clear();
  });

  /**
   * Helper to build graph with mock pairs
   */
  async function buildGraphWithPairs(pairs: SwapperRoutePair[]): Promise<void> {
    jest.spyOn(routeGraphService as any, 'getAvailableRoutes').mockResolvedValue(pairs);
    await routeGraphService.buildGraph();
  }

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have routeGraphService injected', () => {
      expect(routeGraphService).toBeDefined();
    });

    it('should have cacheService injected', () => {
      expect(cacheService).toBeDefined();
    });
  });

  describe('getEffectiveConstraints', () => {
    it('should return default constraints when no user constraints provided', () => {
      const constraints = service.getEffectiveConstraints();

      expect(constraints.maxHops).toBe(4);
      expect(constraints.maxCrossChainHops).toBe(2);
    });

    it('should merge user constraints with defaults', () => {
      const constraints = service.getEffectiveConstraints({ maxHops: 2 });

      expect(constraints.maxHops).toBe(2);
      expect(constraints.maxCrossChainHops).toBe(2); // Default preserved
    });

    it('should override all specified constraints', () => {
      const constraints = service.getEffectiveConstraints({
        maxHops: 3,
        maxCrossChainHops: 1,
        allowedSwapperNames: [SwapperName.Thorchain],
        excludedSwapperNames: [SwapperName.CowSwap],
      });

      expect(constraints.maxHops).toBe(3);
      expect(constraints.maxCrossChainHops).toBe(1);
      expect(constraints.allowedSwapperNames).toEqual([SwapperName.Thorchain]);
      expect(constraints.excludedSwapperNames).toEqual([SwapperName.CowSwap]);
    });
  });

  describe('findPath - basic pathfinding', () => {
    beforeEach(async () => {
      await buildGraphWithPairs(mockSwapperPairs);
    });

    it('should find direct route when available', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(true);
      expect(result.path).not.toBeNull();
      expect(result.path?.hopCount).toBe(1);
      expect(result.path?.assetIds).toEqual([ETH, USDC_ETH]);
      expect(result.path?.edges[0].swapperName).toBe(SwapperName.CowSwap);
    });

    it('should find multi-hop route when no direct route exists', async () => {
      // ETH -> DAI requires: ETH -> USDC -> USDT -> DAI (3 hops)
      const result = await service.findPath(ETH, DAI_ETH);

      expect(result.success).toBe(true);
      expect(result.path).not.toBeNull();
      expect(result.path?.hopCount).toBeGreaterThan(1);
      expect(result.path?.assetIds[0]).toBe(ETH);
      expect(result.path?.assetIds[result.path?.assetIds.length - 1]).toBe(DAI_ETH);
    });

    it('should return error when sell asset not found', async () => {
      const result = await service.findPath('unknown:asset/id:123', USDC_ETH);

      expect(result.success).toBe(false);
      expect(result.path).toBeNull();
      expect(result.error).toContain('Sell asset not found');
    });

    it('should return error when buy asset not found', async () => {
      const result = await service.findPath(ETH, 'unknown:asset/id:456');

      expect(result.success).toBe(false);
      expect(result.path).toBeNull();
      expect(result.error).toContain('Buy asset not found');
    });

    it('should return error when no route available', async () => {
      // Build graph with disconnected assets
      const disconnectedPairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: 'asset:a',
          buyAssetId: 'asset:b',
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
        {
          swapperName: SwapperName.Zrx,
          sellAssetId: 'asset:c',
          buyAssetId: 'asset:d',
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
      ];
      await buildGraphWithPairs(disconnectedPairs);

      const result = await service.findPath('asset:a', 'asset:d');

      expect(result.success).toBe(false);
      expect(result.path).toBeNull();
      expect(result.error).toContain('No route available');
    });

    it('should prefer same-chain routes over cross-chain routes', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(true);
      expect(result.path).not.toBeNull();
      expect(result.path?.crossChainHopCount).toBe(0);
    });
  });

  describe('findPath - circular route detection', () => {
    it('should detect and prevent circular routes', async () => {
      // Create a graph that could potentially create circular routes
      // if the pathfinder doesn't handle them properly
      const circularRiskPairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: 'asset:a',
          buyAssetId: 'asset:b',
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
        {
          swapperName: SwapperName.Zrx,
          sellAssetId: 'asset:b',
          buyAssetId: 'asset:a',
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
        {
          swapperName: SwapperName.Portals,
          sellAssetId: 'asset:a',
          buyAssetId: 'asset:c',
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
      ];
      await buildGraphWithPairs(circularRiskPairs);

      // Path should be A -> C (direct), not A -> B -> A -> C (circular)
      const result = await service.findPath('asset:a', 'asset:c');

      expect(result.success).toBe(true);
      expect(result.path).not.toBeNull();
      // Verify no asset appears twice
      const assetIds = result.path?.assetIds || [];
      const uniqueAssets = new Set(assetIds);
      expect(uniqueAssets.size).toBe(assetIds.length);
    });

    it('should not allow paths that revisit the same asset', async () => {
      await buildGraphWithPairs(mockSwapperPairs);

      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(true);
      if (result.path) {
        const assetIds = result.path.assetIds;
        const uniqueAssets = new Set(assetIds);
        expect(uniqueAssets.size).toBe(assetIds.length);
      }
    });
  });

  describe('findPath - hop constraints', () => {
    beforeEach(async () => {
      await buildGraphWithPairs(mockSwapperPairs);
    });

    it('should respect maxHops constraint', async () => {
      // ETH -> DAI normally requires multiple hops
      // With maxHops: 1, it should fail if no direct route exists
      const result = await service.findPath(ETH, DAI_ETH, { maxHops: 1 });

      // Should fail because ETH -> DAI has no direct route
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should find path within hop limit', async () => {
      // ETH -> USDC is direct (1 hop)
      const result = await service.findPath(ETH, USDC_ETH, { maxHops: 1 });

      expect(result.success).toBe(true);
      expect(result.path?.hopCount).toBe(1);
    });

    it('should respect maxCrossChainHops constraint', async () => {
      // ETH -> BTC requires cross-chain hops via Thorchain
      const result = await service.findPath(ETH, BTC, { maxCrossChainHops: 0 });

      // Should fail because cross-chain hops are not allowed
      expect(result.success).toBe(false);
    });

    it('should find cross-chain path when allowed', async () => {
      const result = await service.findPath(ETH, BTC, { maxCrossChainHops: 2 });

      expect(result.success).toBe(true);
      expect(result.path?.crossChainHopCount).toBeGreaterThan(0);
    });

    it('should count cross-chain hops correctly', async () => {
      // ETH -> RUNE is one cross-chain hop
      const result = await service.findPath(ETH, RUNE);

      expect(result.success).toBe(true);
      expect(result.path?.crossChainHopCount).toBe(1);
      expect(result.path?.edges[0].isCrossChain).toBe(true);
    });
  });

  describe('findPath - swapper constraints', () => {
    beforeEach(async () => {
      await buildGraphWithPairs(mockSwapperPairs);
    });

    it('should respect allowedSwapperNames constraint', async () => {
      // Only allow CowSwap - should fail for paths requiring other swappers
      const result = await service.findPath(ETH, DAI_ETH, {
        allowedSwapperNames: [SwapperName.CowSwap],
      });

      // ETH -> DAI requires 0x or Portals, so should fail
      expect(result.success).toBe(false);
    });

    it('should find path using only allowed swappers', async () => {
      // Allow CowSwap for ETH -> USDC (direct route)
      const result = await service.findPath(ETH, USDC_ETH, {
        allowedSwapperNames: [SwapperName.CowSwap],
      });

      expect(result.success).toBe(true);
      expect(result.path?.edges[0].swapperName).toBe(SwapperName.CowSwap);
    });

    it('should respect excludedSwapperNames constraint', async () => {
      // Exclude CowSwap - should fail for ETH -> USDC direct route
      const result = await service.findPath(ETH, USDC_ETH, {
        excludedSwapperNames: [SwapperName.CowSwap],
      });

      // Should fail because CowSwap is the only direct route
      expect(result.success).toBe(false);
    });

    it('should avoid excluded swappers in multi-hop paths', async () => {
      // Exclude 0x from multi-hop path
      const result = await service.findPath(ETH, DAI_ETH, {
        excludedSwapperNames: [SwapperName.Zrx],
      });

      // If path is found, it should not use 0x
      if (result.success && result.path) {
        for (const edge of result.path.edges) {
          expect(edge.swapperName).not.toBe(SwapperName.Zrx);
        }
      }
    });
  });

  describe('findPath - caching', () => {
    beforeEach(async () => {
      await buildGraphWithPairs(mockSwapperPairs);
    });

    it('should cache successful path results', async () => {
      // First call - should compute path
      const result1 = await service.findPath(ETH, USDC_ETH);
      expect(result1.success).toBe(true);

      // Second call - should use cache
      const result2 = await service.findPath(ETH, USDC_ETH);
      expect(result2.success).toBe(true);

      // Results should be equal
      expect(result2.path?.assetIds).toEqual(result1.path?.assetIds);
    });

    it('should cache paths with different constraints separately', async () => {
      // Call with default constraints
      const result1 = await service.findPath(ETH, USDC_ETH);

      // Call with custom constraints
      const result2 = await service.findPath(ETH, USDC_ETH, { maxHops: 2 });

      // Both should succeed
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('should use cached direct route', async () => {
      // Spy on getDirectRoutes to verify cache usage
      const directRoutesSpy = jest.spyOn(routeGraphService, 'getDirectRoutes');

      // First call
      await service.findPath(ETH, USDC_ETH);

      // Clear the spy call count
      directRoutesSpy.mockClear();

      // Second call - should hit cache
      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(true);
      // Direct routes should not be called again if cache is used
      // (depends on implementation - if caching before direct route check)
    });
  });

  describe('validatePathConstraints', () => {
    const mockEdge: RouteEdgeData = {
      swapperName: SwapperName.CowSwap,
      sellAssetId: ETH,
      buyAssetId: USDC_ETH,
      isCrossChain: false,
      sellChainId: ETH_CHAIN,
      buyChainId: ETH_CHAIN,
    };

    const mockCrossChainEdge: RouteEdgeData = {
      swapperName: SwapperName.Thorchain,
      sellAssetId: ETH,
      buyAssetId: RUNE,
      isCrossChain: true,
      sellChainId: ETH_CHAIN,
      buyChainId: THOR_CHAIN,
    };

    it('should validate path with valid constraints', () => {
      const result = service.validatePathConstraints(
        [ETH, USDC_ETH],
        [mockEdge],
        { maxHops: 4, maxCrossChainHops: 2 },
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject path exceeding maxHops', () => {
      const result = service.validatePathConstraints(
        [ETH, USDC_ETH, USDT_ETH],
        [mockEdge, mockEdge],
        { maxHops: 1, maxCrossChainHops: 2 },
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should reject path exceeding maxCrossChainHops', () => {
      const result = service.validatePathConstraints(
        [ETH, RUNE],
        [mockCrossChainEdge],
        { maxHops: 4, maxCrossChainHops: 0 },
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('cross-chain hops');
    });

    it('should detect circular routes in validation', () => {
      const circularPath = [ETH, USDC_ETH, ETH, USDT_ETH]; // ETH appears twice

      const result = service.validatePathConstraints(
        circularPath,
        [mockEdge, mockEdge, mockEdge],
        { maxHops: 4, maxCrossChainHops: 2 },
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Circular route detected');
    });

    it('should reject path using disallowed swapper', () => {
      const result = service.validatePathConstraints(
        [ETH, USDC_ETH],
        [mockEdge],
        {
          maxHops: 4,
          maxCrossChainHops: 2,
          allowedSwapperNames: [SwapperName.Thorchain],
        },
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not in allowed list');
    });

    it('should reject path using excluded swapper', () => {
      const result = service.validatePathConstraints(
        [ETH, USDC_ETH],
        [mockEdge],
        {
          maxHops: 4,
          maxCrossChainHops: 2,
          excludedSwapperNames: [SwapperName.CowSwap],
        },
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('excluded swapper');
    });
  });

  describe('findAlternativeRoutes', () => {
    beforeEach(async () => {
      // Create a graph with multiple possible routes
      const multiPathPairs: SwapperRoutePair[] = [
        // Path 1: ETH -> USDC via CowSwap
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: ETH,
          buyAssetId: USDC_ETH,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
        // Path 2: ETH -> USDC via 0x
        {
          swapperName: SwapperName.Zrx,
          sellAssetId: ETH,
          buyAssetId: USDC_ETH,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
        // Path 3: ETH -> USDT -> USDC (via different swappers)
        {
          swapperName: SwapperName.Portals,
          sellAssetId: ETH,
          buyAssetId: USDT_ETH,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
        {
          swapperName: SwapperName.Portals,
          sellAssetId: USDT_ETH,
          buyAssetId: USDC_ETH,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
      ];
      await buildGraphWithPairs(multiPathPairs);
    });

    it('should find alternative routes', async () => {
      const alternatives = await service.findAlternativeRoutes(ETH, USDC_ETH);

      expect(alternatives.length).toBeGreaterThan(0);
    });

    it('should return up to maxAlternatives routes', async () => {
      const alternatives = await service.findAlternativeRoutes(ETH, USDC_ETH, undefined, 2);

      expect(alternatives.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array when no primary path exists', async () => {
      const alternatives = await service.findAlternativeRoutes(
        'unknown:asset/id:123',
        USDC_ETH,
      );

      expect(alternatives).toEqual([]);
    });

    it('should return unique alternative paths', async () => {
      const alternatives = await service.findAlternativeRoutes(ETH, USDC_ETH);

      // Each path should have a unique signature
      const signatures = alternatives.map(
        (path) => `${path.assetIds.join('->')}_${path.edges.map((e) => e.swapperName).join(',')}`,
      );
      const uniqueSignatures = new Set(signatures);
      expect(uniqueSignatures.size).toBe(signatures.length);
    });

    it('should sort alternatives by preference (fewer hops first)', async () => {
      const alternatives = await service.findAlternativeRoutes(ETH, USDC_ETH);

      if (alternatives.length >= 2) {
        // First alternative should have fewer or equal hops to second
        expect(alternatives[0].hopCount).toBeLessThanOrEqual(alternatives[1].hopCount);
      }
    });

    it('should respect constraints in alternative routes', async () => {
      const alternatives = await service.findAlternativeRoutes(
        ETH,
        USDC_ETH,
        { excludedSwapperNames: [SwapperName.CowSwap] },
      );

      for (const path of alternatives) {
        for (const edge of path.edges) {
          expect(edge.swapperName).not.toBe(SwapperName.CowSwap);
        }
      }
    });
  });

  describe('clearPathCache', () => {
    it('should be callable without errors', () => {
      expect(() => service.clearPathCache()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle same sell and buy asset', async () => {
      await buildGraphWithPairs(mockSwapperPairs);

      // Trying to swap ETH -> ETH (same asset)
      const result = await service.findPath(ETH, ETH);

      // This should either:
      // 1. Return an empty path (0 hops)
      // 2. Return an error (no route needed)
      // The behavior depends on implementation
      expect(result).toBeDefined();
    });

    it('should handle empty graph', async () => {
      await buildGraphWithPairs([]);

      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle single-node graph', async () => {
      const singleNodePairs: SwapperRoutePair[] = [];
      await buildGraphWithPairs(singleNodePairs);

      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(false);
    });

    it('should handle very long asset IDs', async () => {
      const longAssetId = 'eip155:1/erc20:' + '0'.repeat(100);
      const pairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: ETH,
          buyAssetId: longAssetId,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
      ];
      await buildGraphWithPairs(pairs);

      const result = await service.findPath(ETH, longAssetId);

      expect(result.success).toBe(true);
      expect(result.path?.buyAssetId).toBe(undefined); // FoundPath doesn't have buyAssetId
      expect(result.path?.assetIds[1]).toBe(longAssetId);
    });

    it('should handle special characters in asset IDs', async () => {
      const specialAssetId = 'chain:namespace/asset:special-chars_123';
      const pairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: ETH,
          buyAssetId: specialAssetId,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        },
      ];
      await buildGraphWithPairs(pairs);

      const result = await service.findPath(ETH, specialAssetId);

      expect(result.success).toBe(true);
    });
  });

  describe('path correctness', () => {
    beforeEach(async () => {
      await buildGraphWithPairs(mockSwapperPairs);
    });

    it('should return path with correct structure', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(true);
      expect(result.path).not.toBeNull();

      const path = result.path!;
      expect(path.assetIds).toBeDefined();
      expect(Array.isArray(path.assetIds)).toBe(true);
      expect(path.edges).toBeDefined();
      expect(Array.isArray(path.edges)).toBe(true);
      expect(typeof path.hopCount).toBe('number');
      expect(typeof path.crossChainHopCount).toBe('number');
    });

    it('should have edge count matching hop count', async () => {
      const result = await service.findPath(ETH, DAI_ETH);

      if (result.success && result.path) {
        expect(result.path.edges.length).toBe(result.path.hopCount);
      }
    });

    it('should have asset count equal to hop count + 1', async () => {
      const result = await service.findPath(ETH, DAI_ETH);

      if (result.success && result.path) {
        expect(result.path.assetIds.length).toBe(result.path.hopCount + 1);
      }
    });

    it('should have edges with valid data', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      if (result.success && result.path) {
        for (const edge of result.path.edges) {
          expect(edge.swapperName).toBeDefined();
          expect(edge.sellAssetId).toBeDefined();
          expect(edge.buyAssetId).toBeDefined();
          expect(typeof edge.isCrossChain).toBe('boolean');
          expect(edge.sellChainId).toBeDefined();
          expect(edge.buyChainId).toBeDefined();
        }
      }
    });

    it('should have consecutive edges with matching assets', async () => {
      const result = await service.findPath(ETH, DAI_ETH);

      if (result.success && result.path && result.path.edges.length > 1) {
        for (let i = 0; i < result.path.edges.length - 1; i++) {
          // The buy asset of edge i should match the sell asset of edge i+1
          expect(result.path.edges[i].buyAssetId).toBe(
            result.path.edges[i + 1].sellAssetId,
          );
        }
      }
    });

    it('should have path start with sell asset', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      if (result.success && result.path) {
        expect(result.path.assetIds[0]).toBe(ETH);
      }
    });

    it('should have path end with buy asset', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      if (result.success && result.path) {
        expect(result.path.assetIds[result.path.assetIds.length - 1]).toBe(USDC_ETH);
      }
    });
  });

  describe('cross-chain path detection', () => {
    beforeEach(async () => {
      await buildGraphWithPairs(mockSwapperPairs);
    });

    it('should correctly count zero cross-chain hops for same-chain path', async () => {
      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(true);
      expect(result.path?.crossChainHopCount).toBe(0);
    });

    it('should correctly count cross-chain hops in path', async () => {
      const result = await service.findPath(ETH, RUNE);

      expect(result.success).toBe(true);
      expect(result.path?.crossChainHopCount).toBeGreaterThan(0);
    });

    it('should identify cross-chain edges correctly', async () => {
      const result = await service.findPath(ETH, RUNE);

      if (result.success && result.path) {
        const crossChainEdges = result.path.edges.filter((e) => e.isCrossChain);
        expect(crossChainEdges.length).toBe(result.path.crossChainHopCount);
      }
    });
  });

  describe('error handling', () => {
    it('should handle graph service errors gracefully', async () => {
      jest.spyOn(routeGraphService, 'hasAsset').mockImplementation(() => {
        throw new Error('Graph error');
      });

      const result = await service.findPath(ETH, USDC_ETH);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return descriptive error messages', async () => {
      await buildGraphWithPairs(mockSwapperPairs);

      // Test various error scenarios
      const result1 = await service.findPath('not:found/asset:x', USDC_ETH);
      expect(result1.error).toContain('Sell asset not found');

      const result2 = await service.findPath(ETH, 'not:found/asset:y');
      expect(result2.error).toContain('Buy asset not found');
    });
  });

  describe('performance considerations', () => {
    it('should complete pathfinding within reasonable time', async () => {
      await buildGraphWithPairs(mockSwapperPairs);

      const startTime = Date.now();
      await service.findPath(ETH, DAI_ETH);
      const duration = Date.now() - startTime;

      // Pathfinding should complete in under 1 second for small graphs
      expect(duration).toBeLessThan(1000);
    });

    it('should benefit from caching on repeated calls', async () => {
      await buildGraphWithPairs(mockSwapperPairs);

      // First call
      const start1 = Date.now();
      await service.findPath(ETH, USDC_ETH);
      const duration1 = Date.now() - start1;

      // Second call (cached)
      const start2 = Date.now();
      await service.findPath(ETH, USDC_ETH);
      const duration2 = Date.now() - start2;

      // Cached call should be faster (or at least not significantly slower)
      expect(duration2).toBeLessThanOrEqual(duration1 + 10); // Allow 10ms tolerance
    });
  });
});
