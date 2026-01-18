import { Module } from '@nestjs/common';

/**
 * RoutingModule - NestJS module for multi-step swap routing services.
 *
 * This module will provide services for:
 * - Route caching with configurable TTL
 * - Route graph construction from swapper pairs
 * - Pathfinding using NBA* algorithm
 * - Quote aggregation across multi-hop paths
 *
 * Services will be registered as they are implemented in subsequent phases.
 */
@Module({
  imports: [],
  providers: [
    // Services will be added as they are created:
    // - RouteCacheService (Phase 4)
    // - RouteGraphService (Phase 5)
    // - PathfinderService (Phase 6)
    // - QuoteAggregatorService (Phase 7)
  ],
  exports: [
    // Services will be exported for use by SwapsService:
    // - RouteCacheService
    // - RouteGraphService
    // - PathfinderService
    // - QuoteAggregatorService
  ],
})
export class RoutingModule {}
