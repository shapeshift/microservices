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
  ValidationPipe,
} from '@nestjs/common'

import { AffiliateService } from './affiliate.service'
import { SiweAuthGuard, SiweRequest } from './siwe-auth.guard'
import { AffiliateSwapsQueryDto, type CreateAffiliateDto, type UpdateAffiliateDto } from './types'
import {
  assertAddressQuery,
  assertBpsInRange,
  assertEvmAddress,
  assertOptionalEvmAddress,
  assertPartnerCode,
  assertSiweMatches,
  parseDateRange,
} from './utils'

const AffiliateSwapsQueryPipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

@Controller('v1/affiliate')
export class AffiliateController {
  constructor(private affiliateService: AffiliateService) {}

  @Get('swaps')
  async getSwaps(@Query(AffiliateSwapsQueryPipe) query: AffiliateSwapsQueryDto) {
    return this.affiliateService.getAffiliateSwaps(query.address, query)
  }

  @Get('stats')
  async getStats(
    @Query('address') address: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    assertAddressQuery(address)
    const { start, end } = parseDateRange(startDate, endDate)
    return this.affiliateService.getAffiliateStats(address, start, end)
  }

  @Get(':address')
  async getAffiliate(@Param('address') address: string) {
    const affiliate = await this.affiliateService.getAffiliateByWalletAddress(address)
    if (!affiliate) throw new NotFoundException('Affiliate not found')
    return affiliate
  }

  @UseGuards(SiweAuthGuard)
  @Post()
  async createAffiliate(@Req() req: SiweRequest, @Body() data: CreateAffiliateDto) {
    assertBpsInRange(data.bps)
    assertEvmAddress(data.walletAddress, 'wallet address')
    assertOptionalEvmAddress(data.receiveAddress, 'receive address')
    assertSiweMatches(req, data.walletAddress, 'Authenticated address does not match walletAddress')

    if (data.partnerCode) assertPartnerCode(data.partnerCode)

    try {
      return await this.affiliateService.createAffiliate(data)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('already')) throw new ConflictException(error.message)
      }
      throw error
    }
  }

  @UseGuards(SiweAuthGuard)
  @Patch(':address')
  async updateAffiliate(@Req() req: SiweRequest, @Param('address') address: string, @Body() data: UpdateAffiliateDto) {
    assertBpsInRange(data.bps)
    assertOptionalEvmAddress(data.receiveAddress, 'receive address')
    assertSiweMatches(req, address, 'Authenticated address does not match target address')

    return this.affiliateService.updateAffiliate(address, data)
  }

  @UseGuards(SiweAuthGuard)
  @Post('claim-code')
  async claimPartnerCode(@Req() req: SiweRequest, @Body() data: { walletAddress: string; partnerCode: string }) {
    assertPartnerCode(data.partnerCode)
    assertEvmAddress(data.walletAddress, 'wallet address')
    assertSiweMatches(req, data.walletAddress, 'Authenticated address does not match walletAddress')

    try {
      return await this.affiliateService.claimPartnerCode(data.walletAddress, data.partnerCode)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('taken') || error.message.includes('reserved')) {
          throw new ConflictException(error.message)
        }
        if (error.message.includes('must be')) {
          throw new BadRequestException(error.message)
        }
      }
      throw error
    }
  }

  @Get('lookup/bps')
  async lookupBps(@Query('address') address: string) {
    assertAddressQuery(address)
    const bps = await this.affiliateService.lookupAffiliateBps(address)
    return { bps }
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
