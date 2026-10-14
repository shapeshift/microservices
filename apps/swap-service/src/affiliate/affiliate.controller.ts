import {
  Body,
  Controller,
  Delete,
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
import type { AffiliateRole, ResolvedAffiliate } from './types'
import {
  AddAffiliateMemberDto,
  AffiliateStatsQueryDto,
  AffiliateSwapsQueryDto,
  CreateAffiliateDto,
  UpdateAffiliateDto,
} from './types'
import { assertSiweMatches } from './utils'

const toAffiliateResponse = (affiliate: Affiliate, role: AffiliateRole) => {
  const { bps: partnerBps, ...rest } = affiliate
  return { ...rest, partnerBps, shapeshiftBps: SHAPESHIFT_BPS, role }
}

@Controller('v1/affiliate')
export class AffiliateController {
  constructor(private affiliateService: AffiliateService) {}

  @Get('swaps')
  async getSwaps(@Query() query: AffiliateSwapsQueryDto) {
    return this.affiliateService.getAffiliateSwaps(query.partnerCode, query)
  }

  @Get('stats')
  async getStats(@Query() query: AffiliateStatsQueryDto) {
    return this.affiliateService.getAffiliateStats(query.partnerCode, query)
  }

  @Get()
  async getAffiliates() {
    return this.affiliateService.getAffiliates()
  }

  @Get(':address')
  async getAffiliate(@Param('address') address: string) {
    const { affiliate, role } = await this.resolveOrThrow(address)
    return toAffiliateResponse(affiliate, role)
  }

  @UseGuards(SiweAuthGuard)
  @Post()
  async createAffiliate(@Req() req: SiweRequest, @Body() data: CreateAffiliateDto) {
    assertSiweMatches(req, data.walletAddress, 'Authenticated address does not match walletAddress')

    return toAffiliateResponse(await this.affiliateService.createAffiliate(data), 'owner')
  }

  @UseGuards(SiweAuthGuard)
  @Patch(':address')
  async updateAffiliate(@Req() req: SiweRequest, @Param('address') address: string, @Body() data: UpdateAffiliateDto) {
    const { affiliate, role } = await this.resolveCaller(req, address)

    return toAffiliateResponse(await this.affiliateService.updateAffiliate(affiliate, data), role)
  }

  @UseGuards(SiweAuthGuard)
  @Get(':address/members')
  async getMembers(@Req() req: SiweRequest, @Param('address') address: string) {
    const { affiliate } = await this.resolveCaller(req, address)

    return { members: await this.affiliateService.getMembers(affiliate) }
  }

  @UseGuards(SiweAuthGuard)
  @Post(':address/members')
  async addMember(@Req() req: SiweRequest, @Param('address') address: string, @Body() data: AddAffiliateMemberDto) {
    const { affiliate } = await this.resolveCaller(req, address)
    await this.affiliateService.addMember(affiliate, { walletAddress: data.walletAddress, addedBy: req.siweAddress })

    return { members: await this.affiliateService.getMembers(affiliate) }
  }

  @UseGuards(SiweAuthGuard)
  @Delete(':address/members/:memberAddress')
  async removeMember(
    @Req() req: SiweRequest,
    @Param('address') address: string,
    @Param('memberAddress') memberAddress: string,
  ) {
    const { affiliate } = await this.resolveCaller(req, address)
    await this.affiliateService.removeMember(affiliate, memberAddress)

    return { members: await this.affiliateService.getMembers(affiliate) }
  }

  private async resolveOrThrow(address: string): Promise<ResolvedAffiliate> {
    const resolved = await this.affiliateService.resolveAffiliateByWalletAddress(address)
    if (!resolved) throw new NotFoundException('Affiliate not found')
    return resolved
  }

  // :address is the caller's own wallet; owner and admins both resolve to the one affiliate
  private async resolveCaller(req: SiweRequest, address: string): Promise<ResolvedAffiliate> {
    assertSiweMatches(req, address, 'Authenticated address does not match target address')
    return this.resolveOrThrow(address)
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
