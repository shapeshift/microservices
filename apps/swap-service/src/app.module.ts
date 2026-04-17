import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'

import { AffiliateModule } from './affiliate/affiliate.module'
import { ChainAdaptersModule } from './lib/chain-adapters.module'
import { PrismaModule } from './prisma/prisma.module'
import { SwapsModule } from './swaps/swaps.module'

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: ['.env'] }),
    ScheduleModule.forRoot(),
    AffiliateModule,
    ChainAdaptersModule,
    PrismaModule,
    SwapsModule,
  ],
})
export class AppModule {}
