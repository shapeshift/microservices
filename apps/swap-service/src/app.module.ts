import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'

import { ApiKeyGuard } from '@shapeshift/shared-utils'

import { AffiliateModule } from './affiliate/affiliate.module'
import { ChainAdaptersModule } from './lib/chain-adapters.module'
import { PrismaModule } from './prisma/prisma.module'
import { SwapsModule } from './swaps/swaps.module'

@Module({
  imports: [ScheduleModule.forRoot(), AffiliateModule, ChainAdaptersModule, PrismaModule, SwapsModule],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
