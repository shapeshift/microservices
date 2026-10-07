import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'

import { DeviceSessions, SecurityRateLimiter, ServiceOrDeviceGuard } from '@shapeshift/shared-utils'

import { DeviceAuthController } from './auth/auth.controller'
import { ProfileController } from './auth/profile.controller'
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
  controllers: [UsersController, ReferralController, DeviceAuthController, ProfileController],
  providers: [
    { provide: APP_GUARD, useClass: ServiceOrDeviceGuard },
    UsersService,
    ReferralService,
    PrismaService,
    DeviceSessions,
    SecurityRateLimiter,
    { provide: 'SECURITY_DB', useExisting: PrismaService },
  ],
})
export class AppModule {}
