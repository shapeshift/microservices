import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AffiliateService,
  CreateAffiliateDto,
  UpdateAffiliateDto,
} from './affiliate.service';
import { SiweAuthGuard, SiweRequest } from './siwe-auth.guard';

@Controller('v1/affiliate')
export class AffiliateController {
  constructor(private affiliateService: AffiliateService) {}

  /**
   * GET /v1/affiliate/stats
   * Get affiliate stats (for dashboard)
   */
  @Get('swaps')
  async getSwaps(
    @Query('address') address: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!address) {
      throw new BadRequestException('address query parameter is required');
    }

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    return this.affiliateService.getAffiliateSwaps(
      address,
      start,
      end,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('stats')
  async getStats(
    @Query('address') address: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    if (!address) {
      throw new BadRequestException('address query parameter is required');
    }

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    return this.affiliateService.getAffiliateStats(address, start, end);
  }

  /**
   * GET /v1/affiliate/:address
   * Get affiliate configuration
   */
  @Get(':address')
  async getAffiliate(@Param('address') address: string) {
    const affiliate = await this.affiliateService.getAffiliate(address);

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    return affiliate;
  }

  @UseGuards(SiweAuthGuard)
  @Post()
  async createAffiliate(
    @Req() req: SiweRequest,
    @Body() data: CreateAffiliateDto,
  ) {
    if (
      !data.walletAddress ||
      !/^0x[a-fA-F0-9]{40}$/.test(data.walletAddress)
    ) {
      throw new BadRequestException('Invalid wallet address');
    }

    if (req.siweAddress !== data.walletAddress.toLowerCase()) {
      throw new ForbiddenException(
        'Authenticated address does not match walletAddress',
      );
    }

    if (data.bps !== undefined && (data.bps < 0 || data.bps > 1000)) {
      throw new BadRequestException('BPS must be between 0 and 1000');
    }

    if (data.partnerCode && !/^[a-zA-Z0-9-]{3,32}$/.test(data.partnerCode)) {
      throw new BadRequestException(
        'Partner code must be 3-32 alphanumeric characters or hyphens',
      );
    }

    if (
      data.receiveAddress &&
      !/^0x[a-fA-F0-9]{40}$/.test(data.receiveAddress)
    ) {
      throw new BadRequestException('Invalid receive address');
    }

    try {
      return await this.affiliateService.createAffiliate(data);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('already')) {
          throw new ConflictException(error.message);
        }
      }
      throw error;
    }
  }

  @UseGuards(SiweAuthGuard)
  @Patch(':address')
  async updateAffiliate(
    @Req() req: SiweRequest,
    @Param('address') address: string,
    @Body() data: UpdateAffiliateDto,
  ) {
    if (req.siweAddress !== address.toLowerCase()) {
      throw new ForbiddenException(
        'Authenticated address does not match target address',
      );
    }

    if (data.bps !== undefined && (data.bps < 0 || data.bps > 1000)) {
      throw new BadRequestException('BPS must be between 0 and 1000');
    }

    if (
      data.receiveAddress &&
      !/^0x[a-fA-F0-9]{40}$/.test(data.receiveAddress)
    ) {
      throw new BadRequestException('Invalid receive address');
    }

    try {
      return await this.affiliateService.updateAffiliate(address, data);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw error;
    }
  }

  @UseGuards(SiweAuthGuard)
  @Post('claim-code')
  async claimPartnerCode(
    @Req() req: SiweRequest,
    @Body() data: { walletAddress: string; partnerCode: string },
  ) {
    if (!data.walletAddress || !data.partnerCode) {
      throw new BadRequestException(
        'walletAddress and partnerCode are required',
      );
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(data.walletAddress)) {
      throw new BadRequestException('Invalid wallet address');
    }

    if (req.siweAddress !== data.walletAddress.toLowerCase()) {
      throw new ForbiddenException(
        'Authenticated address does not match walletAddress',
      );
    }

    try {
      return await this.affiliateService.claimPartnerCode(
        data.walletAddress,
        data.partnerCode,
      );
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes('taken') ||
          error.message.includes('reserved')
        ) {
          throw new ConflictException(error.message);
        }
        if (error.message.includes('must be')) {
          throw new BadRequestException(error.message);
        }
      }
      throw error;
    }
  }

  /**
   * GET /v1/affiliate/lookup/bps
   * Lookup affiliate BPS by address (for public-api)
   */
  @Get('lookup/bps')
  async lookupBps(@Query('address') address: string) {
    if (!address) {
      throw new BadRequestException('address query parameter is required');
    }

    const bps = await this.affiliateService.lookupAffiliateBps(address);
    return { bps };
  }
}

@Controller('v1/partner')
export class PartnerController {
  constructor(private affiliateService: AffiliateService) {}

  /**
   * GET /v1/partner/:code
   * Resolve partner code to affiliate config
   */
  @Get(':code')
  async resolvePartnerCode(@Param('code') code: string) {
    const result = await this.affiliateService.resolvePartnerCode(code);

    if (!result) {
      throw new NotFoundException('Partner code not found');
    }

    return result;
  }
}
