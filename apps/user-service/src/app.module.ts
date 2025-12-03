import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { ReferralController } from './referral/referral.controller';
import { ReferralService } from './referral/referral.service';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
  ],
  controllers: [UsersController, ReferralController],
  providers: [UsersService, ReferralService, PrismaService],
})
export class AppModule {}
