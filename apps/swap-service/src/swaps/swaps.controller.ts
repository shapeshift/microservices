import { Controller, Post, Get, Put, Param, Body, Query } from '@nestjs/common';
import { SwapsService } from './swaps.service';
import { SwapPollingService } from '../polling/swap-polling.service';
export { 
  Swap, 
  Notification,
  Prisma 
} from '@prisma/client';
import { Asset } from '@shapeshiftoss/types';
import { CreateSwapDto, UpdateSwapStatusDto } from '@shapeshift/shared-types';

@Controller('swaps')
export class SwapsController {
  constructor(
    private swapsService: SwapsService,
    private swapPollingService: SwapPollingService,
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
}
