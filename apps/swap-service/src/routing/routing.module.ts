import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RouteCacheService } from './route-cache.service';
import { RouteGraphService } from './route-graph.service';
import { PathfinderService } from './pathfinder.service';
import { QuoteAggregatorService } from './quote-aggregator.service';

/**
 * RoutingModule - NestJS module for multi-step swap routing services.
 *
 * This module provides services for:
 * - Route caching with configurable TTL (RouteCacheService)
 * - Route graph construction from swapper pairs (RouteGraphService)
 * - Pathfinding using NBA* algorithm (PathfinderService)
 * - Quote aggregation across multi-hop paths (QuoteAggregatorService)
 *
 * All services are exported for use by SwapsService and other consuming modules.
 */
@Module({
  imports: [HttpModule],
  providers: [
    RouteCacheService,
    RouteGraphService,
    PathfinderService,
    QuoteAggregatorService,
  ],
  exports: [
    RouteCacheService,
    RouteGraphService,
    PathfinderService,
    QuoteAggregatorService,
  ],
})
export class RoutingModule {}
