import { Controller, Post, Get, Put, Param, Body, Query } from '@nestjs/common';
import { ReferralService } from './referral.service';

type CreateReferralCodeDto = {
  code: string;
  ownerAddress: string;
  maxUses?: number;
  expiresAt?: string;
};

type UseReferralCodeDto = {
  code: string;
  refereeAddress: string;
};

type DeactivateReferralCodeDto = {
  ownerAddress: string;
};

@Controller('referrals')
export class ReferralController {
  constructor(private referralService: ReferralService) {}

  @Post('codes')
  async createReferralCode(@Body() data: CreateReferralCodeDto) {
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
    return this.referralService.createReferralCode({
      code: data.code,
      ownerAddress: data.ownerAddress,
      maxUses: data.maxUses,
      expiresAt,
    });
  }

  @Post('use')
  async useReferralCode(@Body() data: UseReferralCodeDto) {
    return this.referralService.useReferralCode(data);
  }

  @Get('codes')
  async getAllReferralCodes(@Query('limit') limit?: string) {
    return this.referralService.getAllReferralCodes(limit ? parseInt(limit) : 50);
  }

  @Get('codes/:code')
  async getReferralCodeByCode(@Param('code') code: string) {
    return this.referralService.getReferralCodeByCode(code);
  }

  @Get('owner/:ownerAddress')
  async getReferralCodesByOwner(@Param('ownerAddress') ownerAddress: string) {
    return this.referralService.getReferralCodesByOwner(ownerAddress);
  }

  @Get('usage/:refereeAddress')
  async getReferralUsageByAddress(@Param('refereeAddress') refereeAddress: string) {
    return this.referralService.getReferralUsageByAddress(refereeAddress);
  }

  @Put('codes/:code/deactivate')
  async deactivateReferralCode(
    @Param('code') code: string,
    @Body() data: DeactivateReferralCodeDto,
  ) {
    return this.referralService.deactivateReferralCode(code, data.ownerAddress);
  }
}
