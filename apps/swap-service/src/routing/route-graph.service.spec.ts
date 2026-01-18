import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import {
  RouteGraphService,
  RouteEdgeData,
  SwapperRoutePair,
} from './route-graph.service';
import { RouteCacheService } from './route-cache.service';
import { SwapperName } from '@shapeshiftoss/swapper';

describe('RouteGraphService', () => {
  let service: RouteGraphService;
  let httpService: HttpService;
  let cacheService: RouteCacheService;

  // Mock HTTP response helper
  const mockHttpResponse = <T>(data: T): AxiosResponse<T> => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as any,
  });

  // Mock swapper route pairs for testing
  const mockSwapperPairs: SwapperRoutePair[] = [
    {
      swapperName: SwapperName.Thorchain,
      sellAssetId: 'cosmos:thorchain-mainnet-v1/slip44:931',
      buyAssetId: 'eip155:1/slip44:60',
      sellChainId: 'cosmos:thorchain-mainnet-v1',
      buyChainId: 'eip155:1',
    },
    {
      swapperName: SwapperName.Thorchain,
      sellAssetId: 'eip155:1/slip44:60',
      buyAssetId: 'cosmos:thorchain-mainnet-v1/slip44:931',
      sellChainId: 'eip155:1',
      buyChainId: 'cosmos:thorchain-mainnet-v1',
    },
    {
      swapperName: SwapperName.CowSwap,
      sellAssetId: 'eip155:1/slip44:60',
      buyAssetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      sellChainId: 'eip155:1',
      buyChainId: 'eip155:1',
    },
    {
      swapperName: SwapperName.Zrx,
      sellAssetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      buyAssetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
      sellChainId: 'eip155:1',
      buyChainId: 'eip155:1',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouteGraphService,
        RouteCacheService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RouteGraphService>(RouteGraphService);
    httpService = module.get<HttpService>(HttpService);
    cacheService = module.get<RouteCacheService>(RouteCacheService);

    // Mock all HTTP calls to return empty arrays by default (prevents actual API calls)
    jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse([])));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should start with empty graph', () => {
      const stats = service.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it('should start with zero statistics', () => {
      const stats = service.getStats();
      expect(stats.swapperCounts).toEqual({});
      expect(stats.crossChainEdgeCount).toBe(0);
      expect(stats.lastBuildTime).toBeNull();
      expect(stats.lastBuildDurationMs).toBeNull();
    });

    it('should have an accessible graph instance', () => {
      const graph = service.getGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.addNode).toBe('function');
      expect(typeof graph.addLink).toBe('function');
    });
  });

  describe('buildGraph', () => {
    it('should build graph from route pairs', async () => {
      // Mock getAvailableRoutes to return test data
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);

      await service.buildGraph();

      const stats = service.getStats();
      expect(stats.nodeCount).toBeGreaterThan(0);
      expect(stats.edgeCount).toBeGreaterThan(0);
    });

    it('should track last build time', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue([]);

      const beforeBuild = Date.now();
      await service.buildGraph();
      const afterBuild = Date.now();

      const stats = service.getStats();
      expect(stats.lastBuildTime).toBeGreaterThanOrEqual(beforeBuild);
      expect(stats.lastBuildTime).toBeLessThanOrEqual(afterBuild);
    });

    it('should track build duration', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue([]);

      await service.buildGraph();

      const stats = service.getStats();
      expect(stats.lastBuildDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should count edges per swapper', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);

      await service.buildGraph();

      const stats = service.getStats();
      expect(stats.swapperCounts[SwapperName.Thorchain]).toBe(2);
      expect(stats.swapperCounts[SwapperName.CowSwap]).toBe(1);
      expect(stats.swapperCounts[SwapperName.Zrx]).toBe(1);
    });

    it('should count cross-chain edges', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);

      await service.buildGraph();

      const stats = service.getStats();
      // Thorchain routes are cross-chain (cosmos <-> eip155)
      expect(stats.crossChainEdgeCount).toBe(2);
    });

    it('should clear cache after building', async () => {
      jest.spyOn(cacheService, 'clear');
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue([]);

      await service.buildGraph();

      expect(cacheService.clear).toHaveBeenCalled();
    });

    it('should replace existing graph on rebuild', async () => {
      // Build with initial pairs
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs.slice(0, 2));
      await service.buildGraph();

      const initialStats = service.getStats();
      expect(initialStats.edgeCount).toBe(2);

      // Rebuild with more pairs
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);
      await service.buildGraph();

      const newStats = service.getStats();
      expect(newStats.edgeCount).toBe(4);
    });

    it('should handle empty route pairs', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue([]);

      await service.buildGraph();

      const stats = service.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it('should throw error on build failure', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockRejectedValue(new Error('API error'));

      await expect(service.buildGraph()).rejects.toThrow('API error');
    });
  });

  describe('node operations', () => {
    beforeEach(async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);
      await service.buildGraph();
    });

    describe('hasAsset', () => {
      it('should return true for existing asset', () => {
        expect(service.hasAsset('eip155:1/slip44:60')).toBe(true);
      });

      it('should return false for non-existing asset', () => {
        expect(service.hasAsset('unknown:asset/id:123')).toBe(false);
      });

      it('should return true for all assets in graph', () => {
        for (const pair of mockSwapperPairs) {
          expect(service.hasAsset(pair.sellAssetId)).toBe(true);
          expect(service.hasAsset(pair.buyAssetId)).toBe(true);
        }
      });
    });

    describe('hasRoutesFrom', () => {
      it('should return true when asset has outgoing routes', () => {
        expect(service.hasRoutesFrom('eip155:1/slip44:60')).toBe(true);
      });

      it('should return false for non-existing asset', () => {
        expect(service.hasRoutesFrom('unknown:asset/id:123')).toBe(false);
      });

      it('should return true for source assets', () => {
        expect(service.hasRoutesFrom('cosmos:thorchain-mainnet-v1/slip44:931')).toBe(true);
        expect(service.hasRoutesFrom('eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true);
      });
    });

    describe('hasRoutesTo', () => {
      it('should return true when asset has incoming routes', () => {
        expect(service.hasRoutesTo('eip155:1/slip44:60')).toBe(true);
      });

      it('should return false for non-existing asset', () => {
        expect(service.hasRoutesTo('unknown:asset/id:123')).toBe(false);
      });

      it('should return true for destination assets', () => {
        expect(service.hasRoutesTo('cosmos:thorchain-mainnet-v1/slip44:931')).toBe(true);
        expect(service.hasRoutesTo('eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7')).toBe(true);
      });
    });
  });

  describe('edge operations', () => {
    beforeEach(async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);
      await service.buildGraph();
    });

    describe('getDirectRoutes', () => {
      it('should return direct routes between two assets', () => {
        const routes = service.getDirectRoutes(
          'cosmos:thorchain-mainnet-v1/slip44:931',
          'eip155:1/slip44:60',
        );

        expect(routes.length).toBe(1);
        expect(routes[0].swapperName).toBe(SwapperName.Thorchain);
      });

      it('should return empty array when no direct route exists', () => {
        const routes = service.getDirectRoutes(
          'cosmos:thorchain-mainnet-v1/slip44:931',
          'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
        );

        expect(routes).toEqual([]);
      });

      it('should return empty array for non-existing source asset', () => {
        const routes = service.getDirectRoutes(
          'unknown:asset/id:123',
          'eip155:1/slip44:60',
        );

        expect(routes).toEqual([]);
      });

      it('should include correct edge data', () => {
        const routes = service.getDirectRoutes(
          'eip155:1/slip44:60',
          'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        );

        expect(routes.length).toBe(1);
        const route = routes[0];
        expect(route.swapperName).toBe(SwapperName.CowSwap);
        expect(route.sellAssetId).toBe('eip155:1/slip44:60');
        expect(route.buyAssetId).toBe('eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        expect(route.isCrossChain).toBe(false);
        expect(route.sellChainId).toBe('eip155:1');
        expect(route.buyChainId).toBe('eip155:1');
      });
    });

    describe('getOutgoingRoutes', () => {
      it('should return all outgoing routes from an asset', () => {
        // ETH has routes to both RUNE and USDC
        const routes = service.getOutgoingRoutes('eip155:1/slip44:60');

        expect(routes.length).toBe(2);
        const swappers = routes.map(r => r.swapperName);
        expect(swappers).toContain(SwapperName.Thorchain);
        expect(swappers).toContain(SwapperName.CowSwap);
      });

      it('should return empty array for non-existing asset', () => {
        const routes = service.getOutgoingRoutes('unknown:asset/id:123');
        expect(routes).toEqual([]);
      });

      it('should include all edge data', () => {
        const routes = service.getOutgoingRoutes('eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');

        expect(routes.length).toBe(1);
        expect(routes[0].swapperName).toBe(SwapperName.Zrx);
        expect(routes[0].isCrossChain).toBe(false);
      });
    });
  });

  describe('cross-chain detection', () => {
    it('should mark same-chain routes as not cross-chain', async () => {
      const sameChainPairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: 'eip155:1/slip44:60',
          buyAssetId: 'eip155:1/erc20:0xusdc',
          sellChainId: 'eip155:1',
          buyChainId: 'eip155:1',
        },
      ];

      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(sameChainPairs);
      await service.buildGraph();

      const routes = service.getDirectRoutes('eip155:1/slip44:60', 'eip155:1/erc20:0xusdc');
      expect(routes[0].isCrossChain).toBe(false);
    });

    it('should mark different-chain routes as cross-chain', async () => {
      const crossChainPairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.Chainflip,
          sellAssetId: 'eip155:1/slip44:60',
          buyAssetId: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
          sellChainId: 'eip155:1',
          buyChainId: 'bip122:000000000019d6689c085ae165831e93',
        },
      ];

      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(crossChainPairs);
      await service.buildGraph();

      const routes = service.getDirectRoutes(
        'eip155:1/slip44:60',
        'bip122:000000000019d6689c085ae165831e93/slip44:0',
      );
      expect(routes[0].isCrossChain).toBe(true);
    });
  });

  describe('duplicate edge prevention', () => {
    it('should not add duplicate edges for same swapper', async () => {
      const duplicatePairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: 'eip155:1/slip44:60',
          buyAssetId: 'eip155:1/erc20:0xusdc',
          sellChainId: 'eip155:1',
          buyChainId: 'eip155:1',
        },
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: 'eip155:1/slip44:60',
          buyAssetId: 'eip155:1/erc20:0xusdc',
          sellChainId: 'eip155:1',
          buyChainId: 'eip155:1',
        },
      ];

      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(duplicatePairs);
      await service.buildGraph();

      const stats = service.getStats();
      expect(stats.edgeCount).toBe(1);
    });

    it('should allow multiple edges between same assets from different swappers', async () => {
      const multiSwapperPairs: SwapperRoutePair[] = [
        {
          swapperName: SwapperName.CowSwap,
          sellAssetId: 'eip155:1/slip44:60',
          buyAssetId: 'eip155:1/erc20:0xusdc',
          sellChainId: 'eip155:1',
          buyChainId: 'eip155:1',
        },
        {
          swapperName: SwapperName.Zrx,
          sellAssetId: 'eip155:1/slip44:60',
          buyAssetId: 'eip155:1/erc20:0xusdc',
          sellChainId: 'eip155:1',
          buyChainId: 'eip155:1',
        },
      ];

      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(multiSwapperPairs);
      await service.buildGraph();

      const stats = service.getStats();
      expect(stats.edgeCount).toBe(2);
      expect(stats.swapperCounts[SwapperName.CowSwap]).toBe(1);
      expect(stats.swapperCounts[SwapperName.Zrx]).toBe(1);
    });
  });

  describe('refreshGraph', () => {
    it('should rebuild graph on refresh', async () => {
      jest.spyOn(service, 'buildGraph').mockResolvedValue();

      await service.refreshGraph();

      expect(service.buildGraph).toHaveBeenCalled();
    });
  });

  describe('getAvailableRoutes', () => {
    it('should aggregate routes from all swappers', async () => {
      // Mock individual swapper methods
      jest.spyOn(service as any, 'getThorchainRoutes').mockResolvedValue([mockSwapperPairs[0]]);
      jest.spyOn(service as any, 'getMayachainRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getChainflipRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getCowSwapRoutes').mockResolvedValue([mockSwapperPairs[2]]);
      jest.spyOn(service as any, 'getZrxRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getRelayRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getPortalsRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getJupiterRoutes').mockResolvedValue([]);

      const routes = await service.getAvailableRoutes();

      expect(routes.length).toBe(2);
    });

    it('should handle partial swapper failures gracefully', async () => {
      jest.spyOn(service as any, 'getThorchainRoutes').mockRejectedValue(new Error('API error'));
      jest.spyOn(service as any, 'getMayachainRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getChainflipRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getCowSwapRoutes').mockResolvedValue([mockSwapperPairs[2]]);
      jest.spyOn(service as any, 'getZrxRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getRelayRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getPortalsRoutes').mockResolvedValue([]);
      jest.spyOn(service as any, 'getJupiterRoutes').mockResolvedValue([]);

      const routes = await service.getAvailableRoutes();

      // Should still get CowSwap routes even though Thorchain failed
      expect(routes.length).toBe(1);
      expect(routes[0].swapperName).toBe(SwapperName.CowSwap);
    });

    it('should return empty array when all swappers fail', async () => {
      jest.spyOn(service as any, 'getThorchainRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getMayachainRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getChainflipRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getCowSwapRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getZrxRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getRelayRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getPortalsRoutes').mockRejectedValue(new Error('Error'));
      jest.spyOn(service as any, 'getJupiterRoutes').mockRejectedValue(new Error('Error'));

      const routes = await service.getAvailableRoutes();

      expect(routes).toEqual([]);
    });
  });

  describe('Thorchain routes', () => {
    it('should parse Thorchain pools and create bidirectional routes', async () => {
      const mockPools = [
        { asset: 'ETH.ETH', status: 'available' },
        { asset: 'BTC.BTC', status: 'available' },
      ];

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockPools)));

      const routes = await (service as any).getThorchainRoutes();

      // Each pool should create 2 routes (RUNE <-> Asset)
      expect(routes.length).toBe(4);

      // Check RUNE -> ETH route
      const runeToEth = routes.find(
        (r: SwapperRoutePair) =>
          r.sellAssetId === 'cosmos:thorchain-mainnet-v1/slip44:931' &&
          r.buyAssetId === 'eip155:1/slip44:60',
      );
      expect(runeToEth).toBeDefined();
      expect(runeToEth.swapperName).toBe(SwapperName.Thorchain);
    });

    it('should skip non-available pools', async () => {
      const mockPools = [
        { asset: 'ETH.ETH', status: 'available' },
        { asset: 'BTC.BTC', status: 'staged' },
      ];

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockPools)));

      const routes = await (service as any).getThorchainRoutes();

      // Only ETH pool should be included
      expect(routes.length).toBe(2);
    });

    it('should handle Thorchain API errors', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('API error')));

      const routes = await (service as any).getThorchainRoutes();

      expect(routes).toEqual([]);
    });

    it('should handle invalid Thorchain response', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse('not an array')));

      const routes = await (service as any).getThorchainRoutes();

      expect(routes).toEqual([]);
    });
  });

  describe('Mayachain routes', () => {
    it('should parse Mayachain pools and create bidirectional routes', async () => {
      const mockPools = [
        { asset: 'ETH.ETH', status: 'available' },
      ];

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockPools)));

      const routes = await (service as any).getMayachainRoutes();

      expect(routes.length).toBe(2);
      expect(routes[0].swapperName).toBe(SwapperName.Mayachain);
    });

    it('should handle Mayachain API errors', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('API error')));

      const routes = await (service as any).getMayachainRoutes();

      expect(routes).toEqual([]);
    });
  });

  describe('Chainflip routes', () => {
    it('should parse Chainflip assets and create all-pairs routes', async () => {
      const mockAssets = {
        assets: [
          { symbol: 'ETH', enabled: true },
          { symbol: 'BTC', enabled: true },
        ],
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockAssets)));

      const routes = await (service as any).getChainflipRoutes();

      // 2 assets = 2 routes (ETH->BTC, BTC->ETH)
      expect(routes.length).toBe(2);
      expect(routes[0].swapperName).toBe(SwapperName.Chainflip);
    });

    it('should skip disabled Chainflip assets', async () => {
      const mockAssets = {
        assets: [
          { symbol: 'ETH', enabled: true },
          { symbol: 'BTC', enabled: false },
        ],
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockAssets)));

      const routes = await (service as any).getChainflipRoutes();

      // Only ETH is enabled, but can't create routes with single asset
      expect(routes.length).toBe(0);
    });

    it('should handle Chainflip API errors', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('API error')));

      const routes = await (service as any).getChainflipRoutes();

      expect(routes).toEqual([]);
    });
  });

  describe('CowSwap routes', () => {
    it('should generate CowSwap routes for supported chains', async () => {
      const routes = await (service as any).getCowSwapRoutes();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].swapperName).toBe(SwapperName.CowSwap);
    });

    it('should only create same-chain pairs', async () => {
      const routes = await (service as any).getCowSwapRoutes();

      for (const route of routes) {
        expect(route.sellChainId).toBe(route.buyChainId);
      }
    });
  });

  describe('0x/ZRX routes', () => {
    it('should generate ZRX routes for supported chains', async () => {
      const routes = await (service as any).getZrxRoutes();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].swapperName).toBe(SwapperName.Zrx);
    });

    it('should only create same-chain pairs', async () => {
      const routes = await (service as any).getZrxRoutes();

      for (const route of routes) {
        expect(route.sellChainId).toBe(route.buyChainId);
      }
    });
  });

  describe('Relay routes', () => {
    it('should parse Relay chains and create cross-chain routes', async () => {
      const mockChains = {
        chains: [
          { id: 1, name: 'Ethereum', enabled: true },
          { id: 42161, name: 'Arbitrum', enabled: true },
        ],
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockChains)));

      const routes = await (service as any).getRelayRoutes();

      // 2 chains = 2 cross-chain routes (1->42161, 42161->1)
      expect(routes.length).toBe(2);
      expect(routes[0].swapperName).toBe(SwapperName.Relay);
    });

    it('should create cross-chain pairs only', async () => {
      const mockChains = {
        chains: [
          { id: 1, name: 'Ethereum', enabled: true },
          { id: 42161, name: 'Arbitrum', enabled: true },
        ],
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockHttpResponse(mockChains)));

      const routes = await (service as any).getRelayRoutes();

      for (const route of routes) {
        expect(route.sellChainId).not.toBe(route.buyChainId);
      }
    });

    it('should handle Relay API errors', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(throwError(() => new Error('API error')));

      const routes = await (service as any).getRelayRoutes();

      expect(routes).toEqual([]);
    });
  });

  describe('Portals routes', () => {
    it('should generate Portals routes for supported chains', async () => {
      const routes = await (service as any).getPortalsRoutes();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].swapperName).toBe(SwapperName.Portals);
    });

    it('should only create same-chain pairs', async () => {
      const routes = await (service as any).getPortalsRoutes();

      for (const route of routes) {
        expect(route.sellChainId).toBe(route.buyChainId);
      }
    });
  });

  describe('Jupiter routes', () => {
    it('should generate Jupiter routes for Solana', async () => {
      const routes = await (service as any).getJupiterRoutes();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes[0].swapperName).toBe(SwapperName.Jupiter);
    });

    it('should only create Solana chain pairs', async () => {
      const routes = await (service as any).getJupiterRoutes();

      const solanaChainId = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
      for (const route of routes) {
        expect(route.sellChainId).toBe(solanaChainId);
        expect(route.buyChainId).toBe(solanaChainId);
      }
    });
  });

  describe('asset ID conversion', () => {
    describe('thorchainAssetToAssetId', () => {
      it('should convert BTC.BTC correctly', () => {
        const result = (service as any).thorchainAssetToAssetId('BTC.BTC');
        expect(result).toBe('bip122:000000000019d6689c085ae165831e93/slip44:0');
      });

      it('should convert ETH.ETH correctly', () => {
        const result = (service as any).thorchainAssetToAssetId('ETH.ETH');
        expect(result).toBe('eip155:1/slip44:60');
      });

      it('should convert ETH ERC20 tokens correctly', () => {
        const result = (service as any).thorchainAssetToAssetId('ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
        expect(result).toBe('eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      });

      it('should return null for unknown assets', () => {
        const result = (service as any).thorchainAssetToAssetId('UNKNOWN.ASSET');
        expect(result).toBeNull();
      });
    });

    describe('thorchainAssetToChainId', () => {
      it('should convert BTC chain correctly', () => {
        const result = (service as any).thorchainAssetToChainId('BTC.BTC');
        expect(result).toBe('bip122:000000000019d6689c085ae165831e93');
      });

      it('should convert ETH chain correctly', () => {
        const result = (service as any).thorchainAssetToChainId('ETH.ETH');
        expect(result).toBe('eip155:1');
      });

      it('should return null for unknown chains', () => {
        const result = (service as any).thorchainAssetToChainId('UNKNOWN.ASSET');
        expect(result).toBeNull();
      });
    });

    describe('chainflipAssetToAssetId', () => {
      it('should convert BTC correctly', () => {
        const result = (service as any).chainflipAssetToAssetId({ symbol: 'BTC' });
        expect(result).toBe('bip122:000000000019d6689c085ae165831e93/slip44:0');
      });

      it('should convert ETH correctly', () => {
        const result = (service as any).chainflipAssetToAssetId({ symbol: 'ETH' });
        expect(result).toBe('eip155:1/slip44:60');
      });

      it('should return null for unknown assets', () => {
        const result = (service as any).chainflipAssetToAssetId({ symbol: 'UNKNOWN' });
        expect(result).toBeNull();
      });
    });
  });

  describe('getStats', () => {
    it('should return copy of stats (not reference)', async () => {
      jest.spyOn(service as any, 'getAvailableRoutes').mockResolvedValue(mockSwapperPairs);
      await service.buildGraph();

      const stats1 = service.getStats();
      const stats2 = service.getStats();

      // Modify one copy
      stats1.nodeCount = 999;

      // Other copy should be unaffected
      expect(stats2.nodeCount).not.toBe(999);
    });
  });

  describe('onModuleInit', () => {
    it('should build graph on module initialization', async () => {
      jest.spyOn(service, 'buildGraph').mockResolvedValue();

      await service.onModuleInit();

      expect(service.buildGraph).toHaveBeenCalled();
    });

    it('should not throw on build failure during init', async () => {
      jest.spyOn(service, 'buildGraph').mockRejectedValue(new Error('Build failed'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
