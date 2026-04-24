import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { AffiliateModule } from './affiliate/affiliate.module'
import { ChainAdaptersModule } from './lib/chain-adapters.module'
import { PrismaModule } from './prisma/prisma.module'
import { SwapsModule } from './swaps/swaps.module'

@Module({
  imports: [ScheduleModule.forRoot(), AffiliateModule, ChainAdaptersModule, PrismaModule, SwapsModule],
})
export class AppModule {}
