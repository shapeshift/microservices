import { Module } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { AffiliateController, PartnerController } from './affiliate.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AffiliateController, PartnerController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
