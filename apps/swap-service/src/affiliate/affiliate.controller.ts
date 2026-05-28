import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Affiliate } from '@prisma/client'

import { SHAPESHIFT_BPS } from '../swaps/constants'

import { AffiliateService } from './affiliate.service'
import { SiweAuthGuard, SiweRequest } from './siwe-auth.guard'
import {
  AffiliateStatsQueryDto,
  AffiliateSwapsQueryDto,
  CreateAffiliateDto,
  UpdateAffiliateDto,
} from './types'
import { assertSiweMatches } from './utils'

const toAffiliateResponse = (affiliate: Affiliate) => {
  const { bps: partnerBps, ...rest } = affiliate
  return { ...rest, partnerBps, shapeshiftBps: SHAPESHIFT_BPS }
}

@Controller('v1/affiliate')
export class AffiliateController {
  constructor(private affiliateService: AffiliateService) {}

  @Get('swaps')
  async getSwaps(@Query() query: AffiliateSwapsQueryDto) {
    return this.affiliateService.getAffiliateSwaps(query.address, query)
  }

  @Get('stats')
  async getStats(@Query() query: AffiliateStatsQueryDto) {
    return this.affiliateService.getAffiliateStats(query.address, query)
  }

  @Get(':address')
  async getAffiliate(@Param('address') address: string) {
    const affiliate = await this.affiliateService.getAffiliateByWalletAddress(address)
    if (!affiliate) throw new NotFoundException('Affiliate not found')
    return toAffiliateResponse(affiliate)
  }

  @UseGuards(SiweAuthGuard)
  @Post()
  async createAffiliate(@Req() req: SiweRequest, @Body() data: CreateAffiliateDto) {
    assertSiweMatches(req, data.walletAddress, 'Authenticated address does not match walletAddress')

    try {
      return toAffiliateResponse(await this.affiliateService.createAffiliate(data))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('reserved')) throw new BadRequestException(error.message)
        if (error.message.includes('already') || error.message.includes('taken')) {
          throw new ConflictException(error.message)
        }
      }
      throw error
    }
  }

  @UseGuards(SiweAuthGuard)
  @Patch(':address')
  async updateAffiliate(@Req() req: SiweRequest, @Param('address') address: string, @Body() data: UpdateAffiliateDto) {
    assertSiweMatches(req, address, 'Authenticated address does not match target address')

    return toAffiliateResponse(await this.affiliateService.updateAffiliate(address, data))
  }
}

@Controller('v1/partner')
export class PartnerController {
  constructor(private affiliateService: AffiliateService) {}

  @Get(':code')
  async resolvePartnerCode(@Param('code') code: string) {
    const result = await this.affiliateService.resolvePartnerCode(code)
    if (!result) throw new NotFoundException('Partner code not found')
    return result
  }
}
