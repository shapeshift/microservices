import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Affiliate, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { getNextCursor, swapCursorArgs } from '../utils/pagination'

import type {
  AffiliateStatsResult,
  AffiliateSwapsResult,
  CreateAffiliateDto,
  GetAffiliateSwapsOptions,
  UpdateAffiliateDto,
} from './types'
import { calculateAffiliateFeeUsd, RESERVED_PARTNER_CODES } from './utils'

@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name)

  constructor(private prisma: PrismaService) {}

  async getAffiliateByWalletAddress(walletAddress: string): Promise<Affiliate | null> {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (!affiliate) return null
    return affiliate
  }

  async getAffiliateByPartnerCode(partnerCode: string): Promise<Affiliate | null> {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { partnerCode } })
    if (!affiliate) return null
    return affiliate
  }

  async createAffiliate(data: CreateAffiliateDto) {
    const { walletAddress, bps, partnerCode, receiveAddress } = data

    const existing = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (existing) throw new Error('Affiliate already registered')

    if (data.partnerCode) {
      const existingCode = await this.prisma.affiliate.findUnique({ where: { partnerCode } })
      if (existingCode) throw new Error('Partner code already taken')
    }

    return this.prisma.affiliate.create({ data: { walletAddress, receiveAddress, partnerCode, bps: bps ?? 60 } })
  }

  async updateAffiliate(walletAddress: string, data: UpdateAffiliateDto) {
    const existing = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (!existing) throw new NotFoundException('Affiliate not found')

    const updateData: Record<string, unknown> = {
      bps: data.bps ?? existing.bps,
      isActive: data.isActive ?? existing.isActive,
    }

    if (data.receiveAddress !== undefined) {
      updateData.receiveAddress = data.receiveAddress
    }

    return this.prisma.affiliate.update({ where: { walletAddress }, data: updateData })
  }

  async claimPartnerCode(walletAddress: string, partnerCode: string) {
    if (RESERVED_PARTNER_CODES.includes(partnerCode.toLowerCase())) throw new Error('This partner code is reserved')

    const existingCode = await this.prisma.affiliate.findUnique({ where: { partnerCode } })
    if (existingCode && existingCode.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error('Partner code already taken')
    }

    return this.prisma.affiliate.upsert({
      where: { walletAddress },
      update: { partnerCode },
      create: { walletAddress, partnerCode, bps: 60 },
    })
  }

  async getAffiliateStats(affiliateAddress: string, startDate?: Date, endDate?: Date): Promise<AffiliateStatsResult> {
    const where: Prisma.SwapWhereInput = {
      affiliateAddress,
      status: 'SUCCESS',
      ...(startDate && endDate && { createdAt: { gte: startDate, lte: endDate } }),
    }

    const totalSwaps = await this.prisma.swap.count({ where })
    const swaps = await this.prisma.swap.findMany({ where, select: { sellAmountUsd: true, affiliateBps: true } })

    let totalVolumeUsd = 0
    let totalFeesEarnedUsd = 0

    for (const swap of swaps) {
      const volumeUsd = parseFloat(swap.sellAmountUsd || '0')
      const bps = parseInt(swap.affiliateBps || '0', 10)

      totalVolumeUsd += volumeUsd
      totalFeesEarnedUsd += volumeUsd * (bps / 10000)
    }

    return {
      totalSwaps,
      totalVolumeUsd: totalVolumeUsd.toFixed(2),
      totalFeesEarnedUsd: totalFeesEarnedUsd.toFixed(2),
    }
  }

  async getAffiliateSwaps(
    affiliateAddress: string,
    options: GetAffiliateSwapsOptions = {},
  ): Promise<AffiliateSwapsResult> {
    const { startDate, endDate, limit = 50, cursor } = options

    const items = await this.prisma.swap.findMany({
      ...swapCursorArgs(limit, cursor),
      where: {
        affiliateAddress,
        ...(startDate && endDate && { createdAt: { gte: startDate, lte: endDate } }),
      },
      select: {
        id: true,
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
    })

    return {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      swaps: items.map(({ id: _id, ...swap }) => ({
        ...swap,
        affiliateFeeUsd: calculateAffiliateFeeUsd(swap.sellAmountUsd, swap.affiliateBps),
      })),
      nextCursor: getNextCursor(items, limit),
    }
  }

  async resolvePartnerCode(partnerCode: string) {
    const affiliate = await this.getAffiliateByPartnerCode(partnerCode)
    if (!affiliate) return null

    return {
      partnerCode: affiliate.partnerCode,
      affiliateAddress: affiliate.receiveAddress ?? affiliate.walletAddress,
      bps: affiliate.bps,
    }
  }

  async lookupAffiliateBps(affiliateAddress: string): Promise<number> {
    const affiliate = await this.getAffiliateByWalletAddress(affiliateAddress)
    return affiliate?.bps ?? 60
  }
}
