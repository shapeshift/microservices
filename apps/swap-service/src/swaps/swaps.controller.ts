import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseDatePipe,
  Post,
  Put,
  Query,
  ValidationPipe,
} from '@nestjs/common'

import type { CreateSwapDto, UpdateSwapStatusDto, VerifySwapAffiliateDto } from '@shapeshift/shared-types'

import { SwapVerificationService } from '../verification/swap-verification.service'

import { SwapsService } from './swaps.service'
import { PaginationQueryDto } from './types'

const OptionalDatePipe = new ParseDatePipe({ optional: true })
const PaginationPipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

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

  @Get(':swapId')
  async getSwapById(@Param('swapId') swapId: string) {
    const swap = await this.swapsService.getSwapById(swapId)
    if (!swap) throw new NotFoundException(`Swap ${swapId} not found`)
    return swap
  }

  @Get('user/:userId')
  async getSwapsByUser(@Param('userId') userId: string, @Query(PaginationPipe) query: PaginationQueryDto) {
    return this.swapsService.getSwapsByUser(userId, query)
  }

  @Get('account/:accountId')
  async getSwapsByAccountId(@Param('accountId') accountId: string, @Query(PaginationPipe) query: PaginationQueryDto) {
    return this.swapsService.getSwapsByAccountId(accountId, query)
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

  @Post(':swapId/verify-affiliate')
  async verifySwapAffiliate(@Param('swapId') swapId: string, @Body() data: Omit<VerifySwapAffiliateDto, 'swapId'>) {
    const swap = await this.swapsService.getSwapById(swapId)
    if (!swap) throw new NotFoundException(`Swap ${swapId} not found`)

    return this.swapVerificationService.verifySwapAffiliate(
      swapId,
      data.protocol || swap.swapperName,
      swap.sellAsset.chainId,
      data.txHash || swap.sellTxHash || undefined,
      swap.metadata as Record<string, any>,
    )
  }
}
