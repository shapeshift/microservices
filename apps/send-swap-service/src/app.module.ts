import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { WalletModule } from './wallet/wallet.module';
import { QuotesModule } from './quotes/quotes.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SwappersModule } from './swappers/swappers.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    ConfigModule.forRoot({
      envFilePath: '../../.env',
    }),
    WalletModule,
    QuotesModule,
    MonitoringModule,
    SwappersModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
