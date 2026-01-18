import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { SwappersModule } from '../swappers/swappers.module';

/**
 * QuotesModule provides quote generation and management functionality.
 *
 * Dependencies:
 * - PrismaService: Database access for quote persistence
 * - WalletModule: Deposit address generation
 * - SwappersModule: Swapper type classification and gas calculation
 */
@Module({
  imports: [WalletModule, SwappersModule],
  providers: [QuotesService, PrismaService],
  exports: [QuotesService],
})
export class QuotesModule {}
