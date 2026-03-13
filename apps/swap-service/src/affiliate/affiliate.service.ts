import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface AffiliateStatsResult {
  totalSwaps: number;
  totalVolumeUsd: string;
  totalFeesEarnedUsd: string;
}

export interface AffiliateSwapItem {
  swapId: string;
  status: string;
  sellAsset: unknown;
  buyAsset: unknown;
  sellAmountCryptoPrecision: string;
  expectedBuyAmountCryptoPrecision: string;
  actualBuyAmountCryptoPrecision: string | null;
  sellAmountUsd: string | null;
  affiliateBps: string | null;
  affiliateFeeUsd: string | null;
  swapperName: string;
  sellTxHash: string | null;
  createdAt: Date;
}

export interface AffiliateSwapsResult {
  swaps: AffiliateSwapItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateAffiliateDto {
  walletAddress: string;
  receiveAddress?: string;
  partnerCode?: string;
  bps?: number;
}

export interface UpdateAffiliateDto {
  receiveAddress?: string;
  bps?: number;
  isActive?: boolean;
}

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get affiliate by wallet address
   */
  async getAffiliate(walletAddress: string) {
    const normalizedAddress = walletAddress.toLowerCase();
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { walletAddress: normalizedAddress },
    });

    if (!affiliate) {
      return null;
    }

    return affiliate;
  }

  /**
   * Get affiliate by partner code
   */
  async getAffiliateByPartnerCode(partnerCode: string) {
    const normalizedCode = partnerCode.toLowerCase();
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { partnerCode: normalizedCode },
    });

    if (!affiliate) {
      return null;
    }

    return affiliate;
  }

  /**
   * Create a new affiliate registration
   */
  async createAffiliate(data: CreateAffiliateDto) {
    const normalizedAddress = data.walletAddress.toLowerCase();
    const normalizedCode = data.partnerCode?.toLowerCase();

    // Check if already exists
    const existing = await this.prisma.affiliate.findUnique({
      where: { walletAddress: normalizedAddress },
    });

    if (existing) {
      throw new Error('Affiliate already registered');
    }

    // Check if partner code is taken
    if (normalizedCode) {
      const existingCode = await this.prisma.affiliate.findUnique({
        where: { partnerCode: normalizedCode },
      });
      if (existingCode) {
        throw new Error('Partner code already taken');
      }
    }

    const normalizedReceiveAddress = data.receiveAddress?.toLowerCase();

    return this.prisma.affiliate.create({
      data: {
        walletAddress: normalizedAddress,
        receiveAddress: normalizedReceiveAddress,
        partnerCode: normalizedCode,
        bps: data.bps ?? 60,
      },
    });
  }

  /**
   * Update affiliate settings
   */
  async updateAffiliate(walletAddress: string, data: UpdateAffiliateDto) {
    const normalizedAddress = walletAddress.toLowerCase();

    const existing = await this.prisma.affiliate.findUnique({
      where: { walletAddress: normalizedAddress },
    });

    if (!existing) {
      throw new NotFoundException('Affiliate not found');
    }

    const updateData: Record<string, unknown> = {
      bps: data.bps ?? existing.bps,
      isActive: data.isActive ?? existing.isActive,
    };

    if (data.receiveAddress !== undefined) {
      updateData.receiveAddress = data.receiveAddress.toLowerCase();
    }

    return this.prisma.affiliate.update({
      where: { walletAddress: normalizedAddress },
      data: updateData,
    });
  }

  /**
   * Claim a partner code for an affiliate
   */
  async claimPartnerCode(walletAddress: string, partnerCode: string) {
    const normalizedAddress = walletAddress.toLowerCase();
    const normalizedCode = partnerCode.toLowerCase();

    // Validate code format
    if (!/^[a-z0-9-]{3,32}$/.test(normalizedCode)) {
      throw new Error(
        'Partner code must be 3-32 alphanumeric characters or hyphens',
      );
    }

    // Check reserved codes
    const reserved = ['ss', 'admin', 'api', 'test', 'demo'];
    if (reserved.includes(normalizedCode)) {
      throw new Error('This partner code is reserved');
    }

    // Check if code is taken
    const existingCode = await this.prisma.affiliate.findUnique({
      where: { partnerCode: normalizedCode },
    });
    if (existingCode && existingCode.walletAddress !== normalizedAddress) {
      throw new Error('Partner code already taken');
    }

    // Update or create affiliate with code
    return this.prisma.affiliate.upsert({
      where: { walletAddress: normalizedAddress },
      update: { partnerCode: normalizedCode },
      create: {
        walletAddress: normalizedAddress,
        partnerCode: normalizedCode,
        bps: 60,
      },
    });
  }

  /**
   * Get affiliate stats - aggregated swap data
   */
  async getAffiliateStats(
    affiliateAddress: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<AffiliateStatsResult> {
    const normalizedAddress = affiliateAddress.toLowerCase();

    const whereClause: Prisma.SwapWhereInput = {
      affiliateAddress: normalizedAddress,
      status: 'SUCCESS',
    };

    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: startDate,
        lte: endDate,
      };
    }

    // Get swap count
    const totalSwaps = await this.prisma.swap.count({
      where: whereClause,
    });

    // Get volume and fees
    const swaps = await this.prisma.swap.findMany({
      where: whereClause,
      select: {
        sellAmountUsd: true,
        affiliateBps: true,
      },
    });

    let totalVolumeUsd = 0;
    let totalFeesEarnedUsd = 0;

    for (const swap of swaps) {
      const volumeUsd = parseFloat(swap.sellAmountUsd || '0');
      const bps = parseInt(swap.affiliateBps || '0', 10);

      totalVolumeUsd += volumeUsd;
      // Fee = volume * (bps / 10000)
      totalFeesEarnedUsd += volumeUsd * (bps / 10000);
    }

    return {
      totalSwaps,
      totalVolumeUsd: totalVolumeUsd.toFixed(2),
      totalFeesEarnedUsd: totalFeesEarnedUsd.toFixed(2),
    };
  }

  /**
   * Get paginated list of swaps for an affiliate address
   */
  async getAffiliateSwaps(
    affiliateAddress: string,
    startDate?: Date,
    endDate?: Date,
    limit = 50,
    offset = 0,
  ): Promise<AffiliateSwapsResult> {
    const normalizedAddress = affiliateAddress.toLowerCase();

    const whereClause: Prisma.SwapWhereInput = {
      affiliateAddress: normalizedAddress,
    };

    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: startDate,
        lte: endDate,
      };
    }

    const [swaps, total] = await Promise.all([
      this.prisma.swap.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          swapId: true,
          status: true,
          sellAsset: true,
          buyAsset: true,
          sellAmountCryptoPrecision: true,
          expectedBuyAmountCryptoPrecision: true,
          actualBuyAmountCryptoPrecision: true,
          sellAmountUsd: true,
          affiliateBps: true,
          swapperName: true,
          sellTxHash: true,
          createdAt: true,
        },
      }),
      this.prisma.swap.count({ where: whereClause }),
    ]);

    return {
      swaps: swaps.map((swap) => ({
        ...swap,
        affiliateFeeUsd: swap.sellAmountUsd && swap.affiliateBps
          ? (parseFloat(swap.sellAmountUsd) * parseInt(swap.affiliateBps, 10) / 10000).toFixed(2)
          : null,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Resolve partner code to affiliate config
   */
  async resolvePartnerCode(partnerCode: string) {
    const affiliate = await this.getAffiliateByPartnerCode(partnerCode);

    if (!affiliate) {
      return null;
    }

    return {
      partnerCode: affiliate.partnerCode,
      affiliateAddress: affiliate.receiveAddress ?? affiliate.walletAddress,
      bps: affiliate.bps,
    };
  }

  /**
   * Lookup affiliate BPS - used by public-api to get correct BPS
   */
  async lookupAffiliateBps(affiliateAddress: string): Promise<number> {
    const affiliate = await this.getAffiliate(affiliateAddress);
    return affiliate?.bps ?? 60; // Default to 60 BPS if not registered
  }
}
