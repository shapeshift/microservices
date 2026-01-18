import { Test, TestingModule } from '@nestjs/testing';
import { RouteCacheService } from './route-cache.service';
import { MultiStepRoute, RouteStep } from '@shapeshift/shared-types';
import { Asset } from '@shapeshiftoss/types';

describe('RouteCacheService', () => {
  let service: RouteCacheService;

  // Mock Asset objects for testing
  const mockSellAsset: Asset = {
    assetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chainId: 'eip155:1',
    symbol: 'USDC',
    name: 'USD Coin',
    precision: 6,
  } as Asset;

  const mockBuyAsset: Asset = {
    assetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
    chainId: 'eip155:1',
    symbol: 'USDT',
    name: 'Tether USD',
    precision: 6,
  } as Asset;

  // Mock data for testing
  const mockRouteStep: RouteStep = {
    stepIndex: 0,
    swapperName: 'Thorchain',
    sellAsset: mockSellAsset,
    buyAsset: mockBuyAsset,
    sellAmountCryptoBaseUnit: '1000000000',
    expectedBuyAmountCryptoBaseUnit: '999000000',
    feeUsd: '0.50',
    slippagePercent: '0.1',
    estimatedTimeSeconds: 30,
  };

  const mockRoute: MultiStepRoute = {
    totalSteps: 1,
    estimatedOutputCryptoBaseUnit: '999000000',
    estimatedOutputCryptoPrecision: '999.00',
    totalFeesUsd: '0.50',
    totalSlippagePercent: '0.1',
    estimatedTimeSeconds: 30,
    steps: [mockRouteStep],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RouteCacheService],
    }).compile();

    service = module.get<RouteCacheService>(RouteCacheService);
  });

  afterEach(() => {
    // Clear cache after each test
    service.clear();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with default configuration', () => {
      const config = service.getConfig();
      expect(config.cacheTtlMs).toBe(30_000);
      expect(config.quoteExpiryMs).toBe(30_000);
      expect(config.priceImpactWarningPercent).toBe(2);
      expect(config.priceImpactFlagPercent).toBe(10);
      expect(config.defaultConstraints.maxHops).toBe(4);
      expect(config.defaultConstraints.maxCrossChainHops).toBe(2);
      expect(config.maxAlternativeRoutes).toBe(3);
    });

    it('should start with empty cache', () => {
      expect(service.size()).toBe(0);
    });

    it('should start with zero statistics', () => {
      const stats = service.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
      expect(stats.evictions).toBe(0);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve a value', () => {
      service.set('test-key', { data: 'test-value' });
      const result = service.get<{ data: string }>('test-key');
      expect(result).toEqual({ data: 'test-value' });
    });

    it('should return null for non-existent key', () => {
      const result = service.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should increment sets counter on set', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      expect(service.getStats().sets).toBe(2);
    });

    it('should increment hits counter on successful get', () => {
      service.set('test-key', 'test-value');
      service.get('test-key');
      service.get('test-key');
      expect(service.getStats().hits).toBe(2);
    });

    it('should increment misses counter on failed get', () => {
      service.get('non-existent-1');
      service.get('non-existent-2');
      expect(service.getStats().misses).toBe(2);
    });

    it('should overwrite existing values', () => {
      service.set('key', 'value1');
      service.set('key', 'value2');
      expect(service.get('key')).toBe('value2');
    });

    it('should handle complex objects', () => {
      service.set('route', mockRoute);
      const result = service.get<MultiStepRoute>('route');
      expect(result).toEqual(mockRoute);
    });
  });

  describe('cache expiration (TTL)', () => {
    it('should return value before TTL expires', () => {
      service.set('temp-key', 'temp-value', 5000); // 5 second TTL
      expect(service.get('temp-key')).toBe('temp-value');
    });

    it('should return null after TTL expires', async () => {
      service.set('short-lived', 'value', 50); // 50ms TTL

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = service.get('short-lived');
      expect(result).toBeNull();
    });

    it('should increment evictions counter when entry expires on get', async () => {
      service.set('expiring', 'value', 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      service.get('expiring');
      expect(service.getStats().evictions).toBe(1);
      expect(service.getStats().misses).toBe(1);
    });

    it('should use default TTL when not specified', () => {
      const config = service.getConfig();
      service.set('default-ttl', 'value');

      // Value should exist immediately
      expect(service.get('default-ttl')).toBe('value');

      // Verify default TTL is 30 seconds
      expect(config.cacheTtlMs).toBe(30_000);
    });

    it('should respect custom TTL', async () => {
      service.set('custom-ttl-short', 'value', 50);
      service.set('custom-ttl-long', 'value', 10000);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(service.get('custom-ttl-short')).toBeNull();
      expect(service.get('custom-ttl-long')).toBe('value');
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      service.set('exists', 'value');
      expect(service.has('exists')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(service.has('does-not-exist')).toBe(false);
    });

    it('should return false for expired key', async () => {
      service.set('expiring', 'value', 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(service.has('expiring')).toBe(false);
    });

    it('should increment evictions counter when has() finds expired entry', async () => {
      service.set('expiring', 'value', 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      service.has('expiring');
      expect(service.getStats().evictions).toBe(1);
    });
  });

  describe('delete', () => {
    it('should delete an existing entry', () => {
      service.set('to-delete', 'value');
      expect(service.has('to-delete')).toBe(true);

      const result = service.delete('to-delete');

      expect(result).toBe(true);
      expect(service.has('to-delete')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const result = service.delete('does-not-exist');
      expect(result).toBe(false);
    });

    it('should reduce cache size', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      expect(service.size()).toBe(2);

      service.delete('key1');
      expect(service.size()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      service.set('key3', 'value3');
      expect(service.size()).toBe(3);

      service.clear();

      expect(service.size()).toBe(0);
    });

    it('should not reset statistics', () => {
      service.set('key', 'value');
      service.get('key');
      service.clear();

      const stats = service.getStats();
      expect(stats.sets).toBe(1);
      expect(stats.hits).toBe(1);
    });
  });

  describe('evictExpired', () => {
    it('should remove expired entries', async () => {
      service.set('short-lived-1', 'value', 50);
      service.set('short-lived-2', 'value', 50);
      service.set('long-lived', 'value', 10000);

      await new Promise(resolve => setTimeout(resolve, 100));

      const evicted = service.evictExpired();

      expect(evicted).toBe(2);
      expect(service.size()).toBe(1);
      expect(service.get('long-lived')).toBe('value');
    });

    it('should return 0 when no entries are expired', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');

      const evicted = service.evictExpired();

      expect(evicted).toBe(0);
    });

    it('should update evictions counter', async () => {
      service.set('expiring-1', 'value', 50);
      service.set('expiring-2', 'value', 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      service.evictExpired();

      expect(service.getStats().evictions).toBe(2);
    });
  });

  describe('cache statistics', () => {
    it('should track hit rate correctly', () => {
      service.set('key', 'value');

      // 2 hits
      service.get('key');
      service.get('key');

      // 2 misses
      service.get('missing1');
      service.get('missing2');

      // 2 hits / 4 total = 50%
      expect(service.getHitRate()).toBe(50);
    });

    it('should return 0 hit rate when no operations', () => {
      expect(service.getHitRate()).toBe(0);
    });

    it('should return 100% hit rate when all hits', () => {
      service.set('key', 'value');
      service.get('key');
      service.get('key');
      service.get('key');

      expect(service.getHitRate()).toBe(100);
    });

    it('should return 0% hit rate when all misses', () => {
      service.get('missing1');
      service.get('missing2');
      service.get('missing3');

      expect(service.getHitRate()).toBe(0);
    });

    it('should return copy of stats (not reference)', () => {
      const stats1 = service.getStats();
      service.set('key', 'value');
      const stats2 = service.getStats();

      expect(stats1.sets).toBe(0);
      expect(stats2.sets).toBe(1);
    });
  });

  describe('key generation', () => {
    it('should generate route key with correct format', () => {
      const sellAsset = 'eip155:1/erc20:0xusdc';
      const buyAsset = 'eip155:1/erc20:0xusdt';

      const key = service.generateRouteKey(sellAsset, buyAsset);

      expect(key).toBe('route:eip155:1/erc20:0xusdc:eip155:1/erc20:0xusdt');
    });

    it('should generate quote key with correct format', () => {
      const sellAsset = 'eip155:1/erc20:0xusdc';
      const buyAsset = 'eip155:1/erc20:0xusdt';
      const amount = '1000000';

      const key = service.generateQuoteKey(sellAsset, buyAsset, amount);

      expect(key).toBe('quote:eip155:1/erc20:0xusdc:eip155:1/erc20:0xusdt:1000000');
    });

    it('should generate unique keys for different asset pairs', () => {
      const key1 = service.generateRouteKey('asset-a', 'asset-b');
      const key2 = service.generateRouteKey('asset-b', 'asset-a');
      const key3 = service.generateRouteKey('asset-a', 'asset-c');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it('should generate unique quote keys for different amounts', () => {
      const key1 = service.generateQuoteKey('asset-a', 'asset-b', '1000');
      const key2 = service.generateQuoteKey('asset-a', 'asset-b', '2000');

      expect(key1).not.toBe(key2);
    });
  });

  describe('cacheRoute and getCachedRoute', () => {
    it('should cache and retrieve a route', () => {
      const sellAsset = 'eip155:1/erc20:0xusdc';
      const buyAsset = 'eip155:1/erc20:0xusdt';

      service.cacheRoute(sellAsset, buyAsset, mockRoute);
      const result = service.getCachedRoute(sellAsset, buyAsset);

      expect(result).toEqual(mockRoute);
    });

    it('should return null for non-cached route', () => {
      const result = service.getCachedRoute('unknown-sell', 'unknown-buy');
      expect(result).toBeNull();
    });

    it('should return null for expired route', async () => {
      // Need to use set directly with short TTL to test expiration
      const key = service.generateRouteKey('sell', 'buy');
      service.set(key, mockRoute, 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      const result = service.getCachedRoute('sell', 'buy');
      expect(result).toBeNull();
    });

    it('should allow caching multiple routes', () => {
      service.cacheRoute('a', 'b', mockRoute);
      service.cacheRoute('b', 'c', mockRoute);
      service.cacheRoute('c', 'd', mockRoute);

      expect(service.size()).toBe(3);
    });
  });

  describe('size', () => {
    it('should return 0 for empty cache', () => {
      expect(service.size()).toBe(0);
    });

    it('should return correct count after adding entries', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      service.set('key3', 'value3');

      expect(service.size()).toBe(3);
    });

    it('should not decrease when entries expire (before access)', async () => {
      service.set('expiring', 'value', 50);
      expect(service.size()).toBe(1);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Size still shows 1 (entry not evicted until accessed)
      expect(service.size()).toBe(1);
    });

    it('should decrease after accessing expired entry', async () => {
      service.set('expiring', 'value', 50);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Access triggers eviction
      service.get('expiring');
      expect(service.size()).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should return copy of config (not reference)', () => {
      const config1 = service.getConfig();
      const config2 = service.getConfig();

      // Modify one config
      config1.cacheTtlMs = 999999;

      // Other config should be unaffected
      expect(config2.cacheTtlMs).toBe(30_000);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string keys', () => {
      service.set('', 'empty-key-value');
      expect(service.get('')).toBe('empty-key-value');
    });

    it('should handle empty string values', () => {
      service.set('empty-value', '');
      expect(service.get('empty-value')).toBe('');
    });

    it('should handle null values', () => {
      service.set('null-value', null);
      // get returns null both for missing entries and null values
      // but the entry should exist
      expect(service.has('null-value')).toBe(true);
    });

    it('should handle undefined values', () => {
      service.set('undefined-value', undefined);
      expect(service.has('undefined-value')).toBe(true);
    });

    it('should handle very long keys', () => {
      const longKey = 'a'.repeat(10000);
      service.set(longKey, 'value');
      expect(service.get(longKey)).toBe('value');
    });

    it('should handle special characters in keys', () => {
      const specialKey = 'key:with/special\nchars';
      service.set(specialKey, 'value');
      expect(service.get(specialKey)).toBe('value');
    });

    it('should handle TTL of 0', async () => {
      service.set('zero-ttl', 'value', 0);
      // With TTL of 0, entry should expire immediately
      await new Promise(resolve => setTimeout(resolve, 1));
      expect(service.get('zero-ttl')).toBeNull();
    });

    it('should handle very large TTL', () => {
      service.set('large-ttl', 'value', Number.MAX_SAFE_INTEGER);
      expect(service.get('large-ttl')).toBe('value');
    });
  });
});
