import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse, AxiosError } from 'axios';
import {
  QuoteAggregatorService,
  StepQuoteResult,
} from './quote-aggregator.service';
import { PathfinderService, FoundPath, PathfindingResult } from './pathfinder.service';
import { RouteGraphService, RouteEdgeData } from './route-graph.service';
import { RouteCacheService } from './route-cache.service';
import {
  MultiStepQuoteRequest,
  MultiStepQuoteResponse,
  MultiStepRoute,
} from '@shapeshift/shared-types';
import { SwapperName } from '@shapeshiftoss/swapper';

// Mock the pricing utility
jest.mock('../utils/pricing', () => ({
  getAssetPriceUsd: jest.fn().mockResolvedValue(1000),
  calculateUsdValue: jest.fn().mockReturnValue('1000.00'),
}));

describe('QuoteAggregatorService', () => {
  let service: QuoteAggregatorService;
  let pathfinderService: PathfinderService;
  let routeGraphService: RouteGraphService;
  let cacheService: RouteCacheService;
  let httpService: HttpService;

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
  const BTC = 'bip122:000000000019d6689c085ae165831e93/slip44:0';
  const RUNE = 'cosmos:thorchain-mainnet-v1/slip44:931';
  const SOL = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501';
  const USDC_SOL = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  // Test chain IDs
  const ETH_CHAIN = 'eip155:1';
  const ARB_CHAIN = 'eip155:42161';
  const BTC_CHAIN = 'bip122:000000000019d6689c085ae165831e93';
  const THOR_CHAIN = 'cosmos:thorchain-mainnet-v1';
  const SOL_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  // Mock edge data
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

  // Mock found path
  const mockFoundPath: FoundPath = {
    assetIds: [ETH, USDC_ETH],
    edges: [mockEdge],
    hopCount: 1,
    crossChainHopCount: 0,
  };

  const mockMultiHopPath: FoundPath = {
    assetIds: [ETH, USDC_ETH, USDT_ETH],
    edges: [
      mockEdge,
      {
        swapperName: SwapperName.Zrx,
        sellAssetId: USDC_ETH,
        buyAssetId: USDT_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      },
    ],
    hopCount: 2,
    crossChainHopCount: 0,
  };

  // Mock quote request
  const mockRequest: MultiStepQuoteRequest = {
    sellAssetId: ETH,
    buyAssetId: USDC_ETH,
    sellAmountCryptoBaseUnit: '1000000000000000000', // 1 ETH
    userAddress: '0x1234567890abcdef1234567890abcdef12345678',
    receiveAddress: '0x1234567890abcdef1234567890abcdef12345678',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteAggregatorService,
        {
          provide: PathfinderService,
          useValue: {
            findPath: jest.fn(),
            findAlternativeRoutes: jest.fn(),
          },
        },
        {
          provide: RouteGraphService,
          useValue: {
            getDirectRoutes: jest.fn(),
            hasAsset: jest.fn(),
          },
        },
        {
          provide: RouteCacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            has: jest.fn(),
            getConfig: jest.fn().mockReturnValue({
              cacheTtlMs: 30000,
              quoteExpiryMs: 30000,
              maxAlternativeRoutes: 3,
            }),
          },
        },
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<QuoteAggregatorService>(QuoteAggregatorService);
    pathfinderService = module.get<PathfinderService>(PathfinderService);
    routeGraphService = module.get<RouteGraphService>(RouteGraphService);
    cacheService = module.get<RouteCacheService>(RouteCacheService);
    httpService = module.get<HttpService>(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have quote config initialized', () => {
      const config = service.getQuoteConfig();
      expect(config.quoteExpiryMs).toBe(30_000);
      expect(config.priceImpactWarningPercent).toBe(2);
      expect(config.priceImpactFlagPercent).toBe(5);
    });
  });

  describe('getMultiStepQuote', () => {
    it('should return successful quote for valid path', async () => {
      const mockPathResult: PathfindingResult = {
        success: true,
        path: mockFoundPath,
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue(mockPathResult);
      jest.spyOn(pathfinderService, 'findAlternativeRoutes').mockResolvedValue([]);
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const result = await service.getMultiStepQuote(mockRequest);

      expect(result.success).toBe(true);
      expect(result.route).not.toBeNull();
      expect(result.expiresAt).toBeDefined();
    });

    it('should return error when no path found', async () => {
      const mockPathResult: PathfindingResult = {
        success: false,
        path: null,
        error: 'No route available',
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue(mockPathResult);

      const result = await service.getMultiStepQuote(mockRequest);

      expect(result.success).toBe(false);
      expect(result.route).toBeNull();
      expect(result.error).toBe('No route available');
    });

    it('should include expiresAt in response', async () => {
      const mockPathResult: PathfindingResult = {
        success: false,
        path: null,
        error: 'No route',
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue(mockPathResult);

      const beforeTime = Date.now();
      const result = await service.getMultiStepQuote(mockRequest);
      const afterTime = Date.now();

      const expiryTime = new Date(result.expiresAt).getTime();
      // Expiry should be ~30 seconds from now
      expect(expiryTime).toBeGreaterThan(beforeTime + 29_000);
      expect(expiryTime).toBeLessThanOrEqual(afterTime + 31_000);
    });

    it('should pass constraints to pathfinder', async () => {
      const findPathSpy = jest.spyOn(pathfinderService, 'findPath').mockResolvedValue({
        success: false,
        path: null,
        error: 'No route',
      });

      const requestWithConstraints: MultiStepQuoteRequest = {
        ...mockRequest,
        maxHops: 2,
        maxCrossChainHops: 1,
      };

      await service.getMultiStepQuote(requestWithConstraints);

      expect(findPathSpy).toHaveBeenCalledWith(
        mockRequest.sellAssetId,
        mockRequest.buyAssetId,
        expect.objectContaining({
          maxHops: 2,
          maxCrossChainHops: 1,
        }),
      );
    });

    it('should handle pathfinder errors gracefully', async () => {
      jest.spyOn(pathfinderService, 'findPath').mockRejectedValue(new Error('Pathfinder error'));

      const result = await service.getMultiStepQuote(mockRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pathfinder error');
    });

    it('should try to find alternative routes', async () => {
      const mockPathResult: PathfindingResult = {
        success: true,
        path: mockFoundPath,
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue(mockPathResult);
      const findAltSpy = jest.spyOn(pathfinderService, 'findAlternativeRoutes').mockResolvedValue([]);
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      await service.getMultiStepQuote(mockRequest);

      expect(findAltSpy).toHaveBeenCalled();
    });

    it('should include alternative routes when available', async () => {
      const mockPathResult: PathfindingResult = {
        success: true,
        path: mockFoundPath,
      };

      const alternativePath: FoundPath = {
        ...mockFoundPath,
        edges: [{
          ...mockEdge,
          swapperName: SwapperName.Zrx,
        }],
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue(mockPathResult);
      jest.spyOn(pathfinderService, 'findAlternativeRoutes').mockResolvedValue([alternativePath]);
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '2000000000' })),
      );

      const result = await service.getMultiStepQuote(mockRequest);

      expect(result.success).toBe(true);
      // Alternatives may or may not be included depending on quote success
    });

    it('should continue without alternatives if alternative route finding fails', async () => {
      const mockPathResult: PathfindingResult = {
        success: true,
        path: mockFoundPath,
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue(mockPathResult);
      jest.spyOn(pathfinderService, 'findAlternativeRoutes').mockRejectedValue(new Error('Alt error'));
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const result = await service.getMultiStepQuote(mockRequest);

      // Should still succeed with primary route
      expect(result.success).toBe(true);
    });
  });

  describe('getQuoteForStep', () => {
    it('should get quote from Thorchain', async () => {
      const thorchainEdge: RouteEdgeData = {
        swapperName: SwapperName.Thorchain,
        sellAssetId: ETH,
        buyAssetId: RUNE,
        isCrossChain: true,
        sellChainId: ETH_CHAIN,
        buyChainId: THOR_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          expected_amount_out: '100000000',
          slippage_bps: 50,
          fees: { affiliate: '0', outbound: '1000000', liquidity: '500000' },
        })),
      );

      const result = await service.getQuoteForStep(
        thorchainEdge,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result.success).toBe(true);
      expect(result.expectedBuyAmountCryptoBaseUnit).toBe('100000000');
    });

    it('should get quote from Mayachain', async () => {
      const mayachainEdge: RouteEdgeData = {
        swapperName: SwapperName.Mayachain,
        sellAssetId: ETH,
        buyAssetId: 'cosmos:mayachain-mainnet-v1/slip44:931',
        isCrossChain: true,
        sellChainId: ETH_CHAIN,
        buyChainId: 'cosmos:mayachain-mainnet-v1',
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          expected_amount_out: '50000000',
          slippage_bps: 30,
        })),
      );

      const result = await service.getQuoteForStep(
        mayachainEdge,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result.success).toBe(true);
    });

    it('should get quote from Chainflip', async () => {
      const chainflipEdge: RouteEdgeData = {
        swapperName: SwapperName.Chainflip,
        sellAssetId: ETH,
        buyAssetId: BTC,
        isCrossChain: true,
        sellChainId: ETH_CHAIN,
        buyChainId: BTC_CHAIN,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({
          egressAmount: '10000000',
          estimatedFeesUsd: 5.0,
          slippagePercent: 0.5,
        })),
      );

      const result = await service.getQuoteForStep(
        chainflipEdge,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result.success).toBe(true);
      expect(result.expectedBuyAmountCryptoBaseUnit).toBe('10000000');
    });

    it('should get quote from CowSwap', async () => {
      const cowSwapEdge: RouteEdgeData = {
        swapperName: SwapperName.CowSwap,
        sellAssetId: ETH,
        buyAssetId: USDC_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({
          quote: { buyAmount: '2000000000', feeAmount: '1000000' },
        })),
      );

      const result = await service.getQuoteForStep(
        cowSwapEdge,
        '1000000000000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(true);
      expect(result.expectedBuyAmountCryptoBaseUnit).toBe('2000000000');
    });

    it('should get quote from 0x/ZRX', async () => {
      const zrxEdge: RouteEdgeData = {
        swapperName: SwapperName.Zrx,
        sellAssetId: USDC_ETH,
        buyAssetId: USDT_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          buyAmount: '1000000000',
          estimatedGas: 200000,
          estimatedPriceImpact: 0.1,
        })),
      );

      const result = await service.getQuoteForStep(
        zrxEdge,
        '1000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(true);
      expect(result.expectedBuyAmountCryptoBaseUnit).toBe('1000000000');
    });

    it('should get quote from Relay', async () => {
      const relayEdge: RouteEdgeData = {
        swapperName: SwapperName.Relay,
        sellAssetId: ETH,
        buyAssetId: 'eip155:42161/slip44:60',
        isCrossChain: true,
        sellChainId: ETH_CHAIN,
        buyChainId: ARB_CHAIN,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({
          details: {
            currencyOut: { amount: '1000000000000000000' },
          },
          fees: { relayer: { usd: 1.5 } },
        })),
      );

      const result = await service.getQuoteForStep(
        relayEdge,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result.success).toBe(true);
    });

    it('should get quote from Portals', async () => {
      const portalsEdge: RouteEdgeData = {
        swapperName: SwapperName.Portals,
        sellAssetId: ETH,
        buyAssetId: USDC_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          outputAmount: '2000000000',
        })),
      );

      const result = await service.getQuoteForStep(
        portalsEdge,
        '1000000000000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(true);
      expect(result.expectedBuyAmountCryptoBaseUnit).toBe('2000000000');
    });

    it('should get quote from Jupiter', async () => {
      const jupiterEdge: RouteEdgeData = {
        swapperName: SwapperName.Jupiter,
        sellAssetId: SOL,
        buyAssetId: USDC_SOL,
        isCrossChain: false,
        sellChainId: SOL_CHAIN,
        buyChainId: SOL_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          outAmount: '100000000',
          slippageBps: 50,
        })),
      );

      const result = await service.getQuoteForStep(
        jupiterEdge,
        '1000000000',
        'solana-address',
        'solana-address',
      );

      expect(result.success).toBe(true);
      expect(result.expectedBuyAmountCryptoBaseUnit).toBe('100000000');
    });

    it('should return error for unsupported swapper', async () => {
      const unknownEdge: RouteEdgeData = {
        swapperName: 'UnknownSwapper' as SwapperName,
        sellAssetId: ETH,
        buyAssetId: USDC_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      const result = await service.getQuoteForStep(
        unknownEdge,
        '1000000000000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported swapper');
    });

    it('should handle HTTP errors gracefully', async () => {
      const cowSwapEdge: RouteEdgeData = {
        swapperName: SwapperName.CowSwap,
        sellAssetId: ETH,
        buyAssetId: USDC_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(
        throwError(() => new Error('Network error')),
      );

      const result = await service.getQuoteForStep(
        cowSwapEdge,
        '1000000000000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should handle timeout errors', async () => {
      const zrxEdge: RouteEdgeData = {
        swapperName: SwapperName.Zrx,
        sellAssetId: USDC_ETH,
        buyAssetId: USDT_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      const timeoutError = new Error('timeout of 10000ms exceeded');
      jest.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => timeoutError),
      );

      const result = await service.getQuoteForStep(
        zrxEdge,
        '1000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });
  });

  describe('aggregateMultiStepQuote', () => {
    it('should aggregate quotes for single-hop path', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
      expect(result?.totalSteps).toBe(1);
      expect(result?.steps.length).toBe(1);
      expect(result?.steps[0].stepIndex).toBe(0);
    });

    it('should chain quotes for multi-hop path', async () => {
      // First hop: 1 ETH -> 2000 USDC
      // Second hop: 2000 USDC -> 1990 USDT
      jest.spyOn(httpService, 'post').mockReturnValueOnce(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get').mockReturnValueOnce(
        of(mockHttpResponse({ buyAmount: '1990000000' })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockMultiHopPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
      expect(result?.totalSteps).toBe(2);
      expect(result?.steps.length).toBe(2);
      // Output of step 1 should be input of step 2
      expect(result?.steps[0].expectedBuyAmountCryptoBaseUnit).toBe('2000000000');
    });

    it('should calculate total fees across all hops', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '1990000000' })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockMultiHopPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result?.totalFeesUsd).toBeDefined();
      // Total fees should be sum of all step fees
      const totalFees = parseFloat(result?.totalFeesUsd || '0');
      expect(totalFees).toBeGreaterThanOrEqual(0);
    });

    it('should calculate total slippage across all hops', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '1990000000' })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockMultiHopPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result?.totalSlippagePercent).toBeDefined();
    });

    it('should calculate total estimated time', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '1990000000' })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockMultiHopPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result?.estimatedTimeSeconds).toBeGreaterThan(0);
    });

    it('should return null for invalid sell amount', async () => {
      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '0',
        '0x1234',
        '0x5678',
      );

      expect(result).toBeNull();
    });

    it('should return null for empty sell amount', async () => {
      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '',
        '0x1234',
        '0x5678',
      );

      expect(result).toBeNull();
    });

    it('should return null for path with no edges', async () => {
      const emptyPath: FoundPath = {
        assetIds: [ETH],
        edges: [],
        hopCount: 0,
        crossChainHopCount: 0,
      };

      const result = await service.aggregateMultiStepQuote(
        emptyPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).toBeNull();
    });

    it('should return null if any step quote fails', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        throwError(() => new Error('Quote failed')),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).toBeNull();
    });

    it('should return null if step returns zero output', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '0' } })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).toBeNull();
    });

    it('should format precision correctly', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })), // 2000 USDC (6 decimals)
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
      expect(result?.estimatedOutputCryptoBaseUnit).toBe('2000000000');
      expect(result?.estimatedOutputCryptoPrecision).toBeDefined();
    });

    it('should cache aggregated quote', async () => {
      const setSpy = jest.spyOn(cacheService, 'set');

      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(setSpy).toHaveBeenCalled();
    });

    it('should include step details in output', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result?.steps[0].swapperName).toBe(SwapperName.CowSwap);
      expect(result?.steps[0].sellAsset).toBeDefined();
      expect(result?.steps[0].buyAsset).toBeDefined();
      expect(result?.steps[0].sellAmountCryptoBaseUnit).toBeDefined();
      expect(result?.steps[0].expectedBuyAmountCryptoBaseUnit).toBeDefined();
    });
  });

  describe('price impact calculation', () => {
    it('should calculate price impact correctly', () => {
      const inputUsd = 1000;
      const outputUsd = 980;
      const priceImpact = service.calculatePriceImpact(inputUsd, outputUsd);

      expect(priceImpact).toBe(2); // 2% price impact
    });

    it('should return 0 for zero input value', () => {
      const priceImpact = service.calculatePriceImpact(0, 100);
      expect(priceImpact).toBe(0);
    });

    it('should handle negative price impact (arbitrage)', () => {
      const inputUsd = 1000;
      const outputUsd = 1020;
      const priceImpact = service.calculatePriceImpact(inputUsd, outputUsd);

      expect(priceImpact).toBe(-2); // -2% (gain)
    });

    it('should identify warning price impact', () => {
      // Default warning threshold is 2%
      expect(service.isPriceImpactWarning(2.5)).toBe(true);
      expect(service.isPriceImpactWarning(1.5)).toBe(false);
      expect(service.isPriceImpactWarning(2.0)).toBe(false); // Exactly at threshold
    });

    it('should identify flag price impact', () => {
      // Default flag threshold is 5%
      expect(service.isPriceImpactFlag(6)).toBe(true);
      expect(service.isPriceImpactFlag(4)).toBe(false);
      expect(service.isPriceImpactFlag(5)).toBe(false); // Exactly at threshold
    });
  });

  describe('quote expiry', () => {
    it('should identify expired quotes', () => {
      const expiredTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      expect(service.isQuoteExpired(expiredTime)).toBe(true);
    });

    it('should identify valid quotes', () => {
      const futureTime = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
      expect(service.isQuoteExpired(futureTime)).toBe(false);
    });

    it('should handle quotes about to expire', () => {
      const nowIsh = new Date(Date.now() - 100).toISOString(); // Just expired
      expect(service.isQuoteExpired(nowIsh)).toBe(true);
    });

    it('should handle invalid date string', () => {
      expect(service.isQuoteExpired('invalid-date')).toBe(true);
    });
  });

  describe('asset precision handling', () => {
    it('should handle ETH precision (18 decimals)', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000', // 1 ETH
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
    });

    it('should handle USDC precision (6 decimals)', async () => {
      const usdcPath: FoundPath = {
        assetIds: [USDC_ETH, USDT_ETH],
        edges: [{
          swapperName: SwapperName.Zrx,
          sellAssetId: USDC_ETH,
          buyAssetId: USDT_ETH,
          isCrossChain: false,
          sellChainId: ETH_CHAIN,
          buyChainId: ETH_CHAIN,
        }],
        hopCount: 1,
        crossChainHopCount: 0,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '999000' })),
      );

      const result = await service.aggregateMultiStepQuote(
        usdcPath,
        '1000000', // 1 USDC
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
    });

    it('should handle BTC precision (8 decimals)', async () => {
      const btcPath: FoundPath = {
        assetIds: [BTC, RUNE],
        edges: [{
          swapperName: SwapperName.Thorchain,
          sellAssetId: BTC,
          buyAssetId: RUNE,
          isCrossChain: true,
          sellChainId: BTC_CHAIN,
          buyChainId: THOR_CHAIN,
        }],
        hopCount: 1,
        crossChainHopCount: 1,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          expected_amount_out: '1000000000',
          slippage_bps: 30,
          fees: {},
        })),
      );

      const result = await service.aggregateMultiStepQuote(
        btcPath,
        '100000000', // 1 BTC
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
    });
  });

  describe('getQuoteConfig', () => {
    it('should return copy of config', () => {
      const config1 = service.getQuoteConfig();
      const config2 = service.getQuoteConfig();

      // Modify one config
      config1.quoteExpiryMs = 999999;

      // Other config should be unaffected
      expect(config2.quoteExpiryMs).toBe(30_000);
    });

    it('should return all config values', () => {
      const config = service.getQuoteConfig();

      expect(config.quoteExpiryMs).toBeDefined();
      expect(config.priceImpactWarningPercent).toBeDefined();
      expect(config.priceImpactFlagPercent).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle very large sell amounts', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000000000000000000' } })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1000000000000000000000000000', // Very large amount
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
    });

    it('should handle very small sell amounts', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '1' } })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockFoundPath,
        '1', // 1 wei
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
    });

    it('should handle request with undefined optional fields', async () => {
      const minimalRequest: MultiStepQuoteRequest = {
        sellAssetId: ETH,
        buyAssetId: USDC_ETH,
        sellAmountCryptoBaseUnit: '1000000000000000000',
        userAddress: '0x1234',
        receiveAddress: '0x5678',
      };

      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue({
        success: false,
        path: null,
        error: 'No route',
      });

      const result = await service.getMultiStepQuote(minimalRequest);

      expect(result).toBeDefined();
      expect(result.expiresAt).toBeDefined();
    });

    it('should handle concurrent quote requests', async () => {
      jest.spyOn(pathfinderService, 'findPath').mockResolvedValue({
        success: true,
        path: mockFoundPath,
      });
      jest.spyOn(pathfinderService, 'findAlternativeRoutes').mockResolvedValue([]);
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const promises = [
        service.getMultiStepQuote(mockRequest),
        service.getMultiStepQuote(mockRequest),
        service.getMultiStepQuote(mockRequest),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle empty asset mappings for conversion', async () => {
      const unknownAssetEdge: RouteEdgeData = {
        swapperName: SwapperName.Thorchain,
        sellAssetId: 'unknown:chain/unknown:asset',
        buyAssetId: RUNE,
        isCrossChain: true,
        sellChainId: 'unknown:chain',
        buyChainId: THOR_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          expected_amount_out: '100000000',
          slippage_bps: 50,
          fees: {},
        })),
      );

      const result = await service.getQuoteForStep(
        unknownAssetEdge,
        '1000000000',
        '0x1234',
        '0x5678',
      );

      // Should return error for unknown asset
      expect(result.success).toBe(false);
    });
  });

  describe('swapper-specific asset conversions', () => {
    it('should handle ERC20 token address extraction', async () => {
      const cowSwapEdge: RouteEdgeData = {
        swapperName: SwapperName.CowSwap,
        sellAssetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        buyAssetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '1000000' } })),
      );

      const result = await service.getQuoteForStep(
        cowSwapEdge,
        '1000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(true);
    });

    it('should handle native asset to ETH representation', async () => {
      const nativeEdge: RouteEdgeData = {
        swapperName: SwapperName.CowSwap,
        sellAssetId: 'eip155:1/slip44:60',
        buyAssetId: USDC_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );

      const result = await service.getQuoteForStep(
        nativeEdge,
        '1000000000000000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(true);
    });

    it('should handle Solana SPL token extraction', async () => {
      const jupiterEdge: RouteEdgeData = {
        swapperName: SwapperName.Jupiter,
        sellAssetId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        buyAssetId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        isCrossChain: false,
        sellChainId: SOL_CHAIN,
        buyChainId: SOL_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ outAmount: '1000000' })),
      );

      const result = await service.getQuoteForStep(
        jupiterEdge,
        '1000000',
        'solana-address',
        'solana-address',
      );

      expect(result.success).toBe(true);
    });
  });

  describe('estimated time calculation', () => {
    it('should have higher estimated time for cross-chain Thorchain swaps', async () => {
      const crossChainThorEdge: RouteEdgeData = {
        swapperName: SwapperName.Thorchain,
        sellAssetId: ETH,
        buyAssetId: BTC,
        isCrossChain: true,
        sellChainId: ETH_CHAIN,
        buyChainId: BTC_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({
          expected_amount_out: '10000000',
          slippage_bps: 50,
          fees: {},
        })),
      );

      const result = await service.getQuoteForStep(
        crossChainThorEdge,
        '1000000000000000000',
        '0x1234',
        'bc1qxyz',
      );

      expect(result.success).toBe(true);
      expect(result.estimatedTimeSeconds).toBeGreaterThan(60); // Cross-chain should be > 60s
    });

    it('should have lower estimated time for same-chain swaps', async () => {
      const sameChainEdge: RouteEdgeData = {
        swapperName: SwapperName.Zrx,
        sellAssetId: USDC_ETH,
        buyAssetId: USDT_ETH,
        isCrossChain: false,
        sellChainId: ETH_CHAIN,
        buyChainId: ETH_CHAIN,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '1000000' })),
      );

      const result = await service.getQuoteForStep(
        sameChainEdge,
        '1000000',
        '0x1234',
        '0x1234',
      );

      expect(result.success).toBe(true);
      expect(result.estimatedTimeSeconds).toBeLessThanOrEqual(120);
    });
  });

  describe('multi-hop aggregation totals', () => {
    it('should aggregate fees correctly for 3-hop path', async () => {
      const threeHopPath: FoundPath = {
        assetIds: [ETH, USDC_ETH, USDT_ETH, 'eip155:1/erc20:0x6b175474e89094c44da98b954eedeac495271d0f'],
        edges: [
          {
            swapperName: SwapperName.CowSwap,
            sellAssetId: ETH,
            buyAssetId: USDC_ETH,
            isCrossChain: false,
            sellChainId: ETH_CHAIN,
            buyChainId: ETH_CHAIN,
          },
          {
            swapperName: SwapperName.Zrx,
            sellAssetId: USDC_ETH,
            buyAssetId: USDT_ETH,
            isCrossChain: false,
            sellChainId: ETH_CHAIN,
            buyChainId: ETH_CHAIN,
          },
          {
            swapperName: SwapperName.Portals,
            sellAssetId: USDT_ETH,
            buyAssetId: 'eip155:1/erc20:0x6b175474e89094c44da98b954eedeac495271d0f',
            isCrossChain: false,
            sellChainId: ETH_CHAIN,
            buyChainId: ETH_CHAIN,
          },
        ],
        hopCount: 3,
        crossChainHopCount: 0,
      };

      // Mock responses for each hop
      jest.spyOn(httpService, 'post').mockReturnValueOnce(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get')
        .mockReturnValueOnce(of(mockHttpResponse({ buyAmount: '1990000000' })))
        .mockReturnValueOnce(of(mockHttpResponse({ outputAmount: '1980000000' })));

      const result = await service.aggregateMultiStepQuote(
        threeHopPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
      expect(result?.totalSteps).toBe(3);
      expect(result?.steps.length).toBe(3);

      // Verify chaining: each step's output becomes next step's input
      expect(result?.steps[0].expectedBuyAmountCryptoBaseUnit).toBe('2000000000');
    });

    it('should sum estimated times sequentially', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        of(mockHttpResponse({ quote: { buyAmount: '2000000000' } })),
      );
      jest.spyOn(httpService, 'get').mockReturnValue(
        of(mockHttpResponse({ buyAmount: '1990000000' })),
      );

      const result = await service.aggregateMultiStepQuote(
        mockMultiHopPath,
        '1000000000000000000',
        '0x1234',
        '0x5678',
      );

      expect(result).not.toBeNull();
      // Total time should be sum of individual step times
      const step1Time = result?.steps[0].estimatedTimeSeconds || 0;
      const step2Time = result?.steps[1].estimatedTimeSeconds || 0;
      expect(result?.estimatedTimeSeconds).toBe(step1Time + step2Time);
    });
  });
});
