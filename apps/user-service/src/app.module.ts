import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { SecurityRateLimiter } from '@shapeshift/shared-utils'

import { OnramperCatalogue, OnramperController } from './onramper/onramper.controller'
import { OnramperAuthController, OnramperSessions, WalletProofVerifier } from './onramper/wallet-auth'
import { PrismaService } from './prisma/prisma.service'
import { ReferralController } from './referral/referral.controller'
import { ReferralService } from './referral/referral.service'
import { UsersController } from './users/users.controller'
import { UsersService } from './users/users.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
  ],
  controllers: [UsersController, ReferralController, OnramperController, OnramperAuthController],
  providers: [
    UsersService,
    ReferralService,
    PrismaService,
    OnramperCatalogue,
    OnramperSessions,
    WalletProofVerifier,
    SecurityRateLimiter,
    { provide: 'SECURITY_DB', useExisting: PrismaService },
  ],
})
export class AppModule {}
