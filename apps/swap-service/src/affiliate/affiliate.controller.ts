import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  AffiliateService,
  CreateAffiliateDto,
  UpdateAffiliateDto,
} from './affiliate.service';

@Controller('v1/affiliate')
export class AffiliateController {
  constructor(private affiliateService: AffiliateService) {}

  /**
   * GET /v1/affiliate/stats
   * Get affiliate stats (for dashboard)
   */
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

  /**
   * POST /v1/affiliate
   * Register as affiliate
   * Note: In production, this should require SIWE authentication
   */
  @Post()
  async createAffiliate(@Body() data: CreateAffiliateDto) {
    // Validate wallet address
    if (!data.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(data.walletAddress)) {
      throw new BadRequestException('Invalid wallet address');
    }

    // Validate BPS range
    if (data.bps !== undefined && (data.bps < 0 || data.bps > 1000)) {
      throw new BadRequestException('BPS must be between 0 and 1000');
    }

    // Validate partner code format
    if (
      data.partnerCode &&
      !/^[a-zA-Z0-9-]{3,32}$/.test(data.partnerCode)
    ) {
      throw new BadRequestException(
        'Partner code must be 3-32 alphanumeric characters or hyphens',
      );
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

  /**
   * PATCH /v1/affiliate/:address
   * Update affiliate settings
   * Note: In production, this should require SIWE authentication matching address
   */
  @Patch(':address')
  async updateAffiliate(
    @Param('address') address: string,
    @Body() data: UpdateAffiliateDto,
  ) {
    // Validate BPS range
    if (data.bps !== undefined && (data.bps < 0 || data.bps > 1000)) {
      throw new BadRequestException('BPS must be between 0 and 1000');
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

  /**
   * POST /v1/affiliate/claim-code
   * Claim a partner code
   * Note: In production, this should require SIWE authentication
   */
  @Post('claim-code')
  async claimPartnerCode(
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
