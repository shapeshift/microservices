import { Body, Controller, Get, NotFoundException, Param, ParseDatePipe, Post, Query } from '@nestjs/common'

import type { CreateSwapDto } from '@shapeshift/shared-types'

import { SwapsService } from './swaps.service'
import { PaginationQueryDto } from './types'

const OptionalDatePipe = new ParseDatePipe({ optional: true })

@Controller('swaps')
export class SwapsController {
  constructor(private swapsService: SwapsService) {}

  @Post()
  async createSwap(@Body() data: CreateSwapDto) {
    return this.swapsService.createSwap(data)
  }

  @Get(':swapId')
  async getSwapById(@Param('swapId') swapId: string) {
    const swap = await this.swapsService.getSwapById(swapId)
    if (!swap) throw new NotFoundException(`Swap ${swapId} not found`)
    return swap
  }

  @Get('user/:userId')
  async getSwapsByUser(@Param('userId') userId: string, @Query() query: PaginationQueryDto) {
    return this.swapsService.getSwapsByUser(userId, query)
  }

  @Get('account/:accountId')
  async getSwapsByAccountId(@Param('accountId') accountId: string, @Query() query: PaginationQueryDto) {
    return this.swapsService.getSwapsByAccountId(accountId, query)
  }

  @Get('referral-fees/:referralCode')
  async getReferralFees(
    @Param('referralCode') referralCode: string,
    @Query('startDate', OptionalDatePipe) startDate?: Date,
    @Query('endDate', OptionalDatePipe) endDate?: Date,
  ) {
    return this.swapsService.calculateReferralFees(referralCode, startDate, endDate)
  }
}
