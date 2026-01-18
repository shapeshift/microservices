import { Injectable, Logger } from '@nestjs/common';
import { MultiStepRoute, RouteConfig } from '@shapeshift/shared-types';

/**
 * Cache entry with value and expiration timestamp
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache statistics for observability
 */
interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
}

/**
 * Default route configuration with 30-second TTL
 */
const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  cacheTtlMs: 30_000, // 30 seconds
  quoteExpiryMs: 30_000, // 30 seconds
  priceImpactWarningPercent: 2,
  priceImpactFlagPercent: 10,
  defaultConstraints: {
    maxHops: 4,
    maxCrossChainHops: 2,
  },
  maxAlternativeRoutes: 3,
};

/**
 * RouteCacheService - In-memory cache for route data with configurable TTL.
 *
 * Provides caching for:
 * - Route graph data
 * - Computed paths between asset pairs
 * - Multi-step quotes
 *
 * Features:
 * - Configurable TTL (default: 30 seconds)
 * - Cache statistics for monitoring hit/miss rates
 * - Automatic expiration on retrieval
 */
@Injectable()
export class RouteCacheService {
  private readonly logger = new Logger(RouteCacheService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0,
  };
  private readonly config: RouteConfig;

  constructor() {
    this.config = DEFAULT_ROUTE_CONFIG;
    this.logger.log(`Route cache initialized with TTL: ${this.config.cacheTtlMs}ms`);
  }

  /**
   * Get a cached value by key
   * @param key Cache key
   * @returns Cached value or null if not found/expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      this.logger.debug(`Cache entry expired: ${key}`);
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a cached value with TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional TTL in milliseconds (defaults to config.cacheTtlMs)
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.config.cacheTtlMs;
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + effectiveTtl,
    };

    this.cache.set(key, entry);
    this.stats.sets++;
    this.logger.debug(`Cache entry set: ${key} (TTL: ${effectiveTtl}ms)`);
  }

  /**
   * Check if a key exists and is not expired
   * @param key Cache key
   * @returns true if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }

    return true;
  }

  /**
   * Delete a cached entry
   * @param key Cache key
   * @returns true if entry was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.logger.log(`Cache cleared: ${count} entries removed`);
  }

  /**
   * Get current cache statistics
   * @returns Cache hit/miss statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache hit rate as a percentage
   * @returns Hit rate between 0 and 100
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return (this.stats.hits / total) * 100;
  }

  /**
   * Get the current route configuration
   * @returns RouteConfig
   */
  getConfig(): RouteConfig {
    return { ...this.config };
  }

  /**
   * Generate a cache key for a route query
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @returns Cache key string
   */
  generateRouteKey(sellAssetId: string, buyAssetId: string): string {
    return `route:${sellAssetId}:${buyAssetId}`;
  }

  /**
   * Generate a cache key for a multi-step quote
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @param sellAmount Sell amount in base units
   * @returns Cache key string
   */
  generateQuoteKey(
    sellAssetId: string,
    buyAssetId: string,
    sellAmount: string,
  ): string {
    return `quote:${sellAssetId}:${buyAssetId}:${sellAmount}`;
  }

  /**
   * Cache a computed route
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @param route The multi-step route to cache
   */
  cacheRoute(
    sellAssetId: string,
    buyAssetId: string,
    route: MultiStepRoute,
  ): void {
    const key = this.generateRouteKey(sellAssetId, buyAssetId);
    this.set(key, route);
    this.logger.debug(`Cached route: ${sellAssetId} -> ${buyAssetId}`);
  }

  /**
   * Get a cached route
   * @param sellAssetId Source asset identifier
   * @param buyAssetId Destination asset identifier
   * @returns Cached route or null if not found/expired
   */
  getCachedRoute(
    sellAssetId: string,
    buyAssetId: string,
  ): MultiStepRoute | null {
    const key = this.generateRouteKey(sellAssetId, buyAssetId);
    return this.get<MultiStepRoute>(key);
  }

  /**
   * Get the number of entries in the cache
   * @returns Number of cached entries
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clean up expired entries (manual eviction)
   * @returns Number of entries evicted
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.stats.evictions += evicted;
      this.logger.debug(`Evicted ${evicted} expired cache entries`);
    }

    return evicted;
  }
}
