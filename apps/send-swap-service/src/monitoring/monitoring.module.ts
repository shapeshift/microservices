import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DepositMonitorService } from './deposit-monitor.service';
import { QuotesModule } from '../quotes/quotes.module';
import { ExecutionModule } from '../execution/execution.module';

/**
 * MonitoringModule provides deposit monitoring functionality for send-swap operations.
 *
 * This module:
 * - Runs periodic cron jobs to check for deposits
 * - Monitors active quote deposit addresses
 * - Updates quote status when deposits are detected
 * - Queries blockchain APIs for transaction detection
 * - Executes swaps via SwapExecutorService after deposit confirmation
 *
 * Dependencies:
 * - QuotesModule: Access to quotes for monitoring and status updates
 * - ExecutionModule: Swap execution after deposit detection
 * - HttpModule: HTTP client for blockchain API queries
 * - ConfigModule: Access to Unchained URLs and other configuration
 * - ScheduleModule: Must be imported in AppModule for cron functionality
 */
@Module({
  imports: [
    QuotesModule,
    ExecutionModule,
    HttpModule,
    ConfigModule,
  ],
  providers: [DepositMonitorService],
  exports: [DepositMonitorService],
})
export class MonitoringModule {}
