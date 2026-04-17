import { Module } from '@nestjs/common'

import { AffiliateController, PartnerController } from './affiliate.controller'
import { AffiliateService } from './affiliate.service'
import { SiweAuthController } from './siwe-auth.controller'

@Module({
  controllers: [AffiliateController, PartnerController, SiweAuthController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
