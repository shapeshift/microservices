import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseDatePipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common'

import type { CreateSwapDto, UpdateSwapStatusDto, VerifySwapAffiliateDto } from '@shapeshift/shared-types'
import type { Asset } from '@shapeshiftoss/types'

import { SwapVerificationService } from '../verification/swap-verification.service'

import { SwapsService } from './swaps.service'

const OptionalDatePipe = new ParseDatePipe({ optional: true })

@Controller('swaps')
export class SwapsController {
  constructor(
    private swapsService: SwapsService,
    private swapVerificationService: SwapVerificationService,
  ) {}

  @Post()
  async createSwap(@Body() data: CreateSwapDto) {
    return this.swapsService.createSwap(data)
  }

  @Put(':swapId/status')
  async updateSwapStatus(@Param('swapId') swapId: string, @Body() data: Omit<UpdateSwapStatusDto, 'swapId'>) {
    return this.swapsService.updateSwapStatus({ swapId, ...data })
  }

  @Get('user/:userId')
  async getSwapsByUser(
    @Param('userId') userId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.swapsService.getSwapsByUser(userId, { limit, cursor })
  }

  @Get('account/:accountId')
  async getSwapsByAccountId(
    @Param('accountId') accountId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.swapsService.getSwapsByAccountId(accountId, { limit, cursor })
  }

  @Get('pending')
  async getPendingSwaps() {
    return this.swapsService.getPendingSwaps()
  }

  @Get('referral-fees/:referralCode')
  async getReferralFees(
    @Param('referralCode') referralCode: string,
    @Query('startDate', OptionalDatePipe) startDate?: Date,
    @Query('endDate', OptionalDatePipe) endDate?: Date,
  ) {
    return this.swapsService.calculateReferralFees(referralCode, startDate, endDate)
  }

  @Get('affiliate-fees/:affiliateAddress')
  async getAffiliateFees(
    @Param('affiliateAddress') affiliateAddress: string,
    @Query('startDate', OptionalDatePipe) startDate?: Date,
    @Query('endDate', OptionalDatePipe) endDate?: Date,
  ) {
    return this.swapsService.calculateAffiliateFees(affiliateAddress, startDate, endDate)
  }

  @Get(':swapId')
  async getSwap(@Param('swapId') swapId: string) {
    const swap = await this.swapsService.findSwapBySwapId(swapId)
    if (!swap) throw new NotFoundException(`Swap ${swapId} not found`)
    return swap
  }

  @Post(':swapId/verify-affiliate')
  async verifySwapAffiliate(@Param('swapId') swapId: string, @Body() data: Omit<VerifySwapAffiliateDto, 'swapId'>) {
    const swap = await this.swapsService.findSwapBySwapId(swapId)
    if (!swap) throw new NotFoundException(`Swap ${swapId} not found`)

    return this.swapVerificationService.verifySwapAffiliate(
      swapId,
      data.protocol || swap.swapperName,
      (swap.sellAsset as Asset).chainId,
      data.txHash || swap.sellTxHash || undefined,
      swap.metadata as Record<string, any>,
    )
  }
}
