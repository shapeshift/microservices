import { Module } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AffiliateController, PartnerController } from './affiliate.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [AffiliateController, PartnerController],
  providers: [PrismaService, AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
