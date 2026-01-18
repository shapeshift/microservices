import { Module } from '@nestjs/common';
import { DepositMonitorService } from './deposit-monitor.service';
import { QuotesModule } from '../quotes/quotes.module';

/**
 * MonitoringModule provides deposit monitoring functionality for send-swap operations.
 *
 * This module:
 * - Runs periodic cron jobs to check for deposits
 * - Monitors active quote deposit addresses
 * - Updates quote status when deposits are detected
 *
 * Dependencies:
 * - QuotesModule: Access to quotes for monitoring and status updates
 * - ScheduleModule: Must be imported in AppModule for cron functionality
 */
@Module({
  imports: [QuotesModule],
  providers: [DepositMonitorService],
  exports: [DepositMonitorService],
})
export class MonitoringModule {}
