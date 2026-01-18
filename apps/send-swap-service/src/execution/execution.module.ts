import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SwapExecutorService } from './swap-executor.service';

/**
 * ExecutionModule provides swap execution functionality for send-swap operations.
 *
 * This module:
 * - Routes swap execution based on swapper type (DIRECT vs SERVICE_WALLET)
 * - Handles swap status checking for DIRECT swappers
 * - Initiates swap transactions for SERVICE_WALLET swappers
 * - Provides retry functionality for failed swaps
 *
 * Dependencies:
 * - HttpModule: HTTP client for swapper API queries
 * - ConfigModule: Access to swapper API URLs and credentials
 */
@Module({
  imports: [
    HttpModule,
    ConfigModule,
  ],
  providers: [SwapExecutorService],
  exports: [SwapExecutorService],
})
export class ExecutionModule {}
