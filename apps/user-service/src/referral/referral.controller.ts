import { Controller, Post, Get, Put, Param, Body, Query } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { hashAccountId, isValidAccountId } from '@shapeshift/shared-utils';

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
    if (!isValidAccountId(data.ownerAddress)) {
      throw new Error('Invalid account ID');
    }
    const hashedOwnerAddress = hashAccountId(data.ownerAddress);
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
    return this.referralService.createReferralCode({
      code: data.code,
      ownerAddress: hashedOwnerAddress,
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
    if (!isValidAccountId(ownerAddress)) {
      throw new Error('Invalid account ID');
    }
    const hashedOwnerAddress = hashAccountId(ownerAddress);
    return this.referralService.getReferralCodesByOwner(hashedOwnerAddress);
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
    if (!isValidAccountId(data.ownerAddress)) {
      throw new Error('Invalid account ID');
    }
    const hashedOwnerAddress = hashAccountId(data.ownerAddress);
    return this.referralService.deactivateReferralCode(code, hashedOwnerAddress);
  }

  @Get('stats/:ownerAddress')
  async getReferralStats(
    @Param('ownerAddress') ownerAddress: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!isValidAccountId(ownerAddress)) {
      throw new Error('Invalid account ID');
    }
    const hashedOwnerAddress = hashAccountId(ownerAddress);
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.referralService.getReferralStatsByOwner(hashedOwnerAddress, start, end);
  }
}
