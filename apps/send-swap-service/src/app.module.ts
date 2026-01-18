import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { WalletModule } from './wallet/wallet.module';
import { MonitoringModule } from './monitoring/monitoring.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    ConfigModule.forRoot({
      envFilePath: '../../.env',
    }),
    WalletModule,
    MonitoringModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
