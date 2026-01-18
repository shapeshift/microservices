import { Controller, Post, Get, Put, Param, Body, Query } from '@nestjs/common';
import { SwapsService } from './swaps.service';
import { SwapPollingService } from '../polling/swap-polling.service';
import { SwapVerificationService } from '../verification/swap-verification.service';
export {
  Swap,
  Notification,
  Prisma
} from '@prisma/client';
import { Asset } from '@shapeshiftoss/types';
import { CreateSwapDto, UpdateSwapStatusDto, VerifySwapAffiliateDto, MultiStepQuoteRequest } from '@shapeshift/shared-types';

@Controller('swaps')
export class SwapsController {
  constructor(
    private swapsService: SwapsService,
    private swapPollingService: SwapPollingService,
    private swapVerificationService: SwapVerificationService,
  ) {}

  @Post()
  async createSwap(@Body() data: CreateSwapDto) {
    return this.swapsService.createSwap(data);
  }

  @Put(':swapId/status')
  async updateSwapStatus(
    @Param('swapId') swapId: string,
    @Body() data: Omit<UpdateSwapStatusDto, 'swapId'>,
  ) {
    return this.swapsService.updateSwapStatus({
      swapId,
      ...data,
    });
  }

  @Get('user/:userId')
  async getSwapsByUser(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.swapsService.getSwapsByUser(
      userId,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get('account/:accountId')
  async getSwapsByAccountId(@Param('accountId') accountId: string) {
    return this.swapsService.getSwapsByAccountId(accountId);
  }

  @Get('pending')
  async getPendingSwaps() {
    return this.swapsService.getPendingSwaps();
  }

  @Get('referral-fees/:referralCode')
  async getReferralFees(
    @Param('referralCode') referralCode: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.swapsService.calculateReferralFees(referralCode, start, end);
  }

  @Post('multi-step-quote')
  async getMultiStepQuote(@Body() data: MultiStepQuoteRequest) {
    return this.swapsService.getMultiStepQuote(data);
  }

  @Get(':swapId')
  async getSwap(@Param('swapId') swapId: string) {
    const swap = await this.swapsService['prisma'].swap.findUnique({
      where: { swapId },
      include: {
        notifications: {
          orderBy: { sentAt: 'desc' },
        },
      },
    });

    if (!swap) {
      return null;
    }

    return {
      ...swap,
      sellAsset: swap.sellAsset,
      buyAsset: swap.buyAsset,
    };
  }

  @Post(':swapId/verify-affiliate')
  async verifySwapAffiliate(
    @Param('swapId') swapId: string,
    @Body() data: Omit<VerifySwapAffiliateDto, 'swapId'>,
  ) {
    // Fetch the swap to get metadata and other details
    const swap = await this.swapsService['prisma'].swap.findUnique({
      where: { swapId },
    });

    if (!swap) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: data.protocol,
        swapId,
        error: 'Swap not found',
      };
    }

    return this.swapVerificationService.verifySwapAffiliate(
      swapId,
      data.protocol || swap.swapperName,
      (swap.sellAsset as Asset).chainId,
      data.txHash || swap.sellTxHash || undefined,
      swap.metadata as Record<string, any>,
    );
  }
}
