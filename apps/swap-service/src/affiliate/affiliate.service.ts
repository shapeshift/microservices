import { Injectable, NotFoundException } from '@nestjs/common'
import { Affiliate, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { SHAPESHIFT_BPS } from '../swaps/constants'
import { calculateFeeForSwap, getPartnerFeeRate, toSwap } from '../swaps/utils'
import { getNextCursor, swapCursorArgs } from '../utils/pagination'

import type { AffiliateStatsResult, CreateAffiliateDto, UpdateAffiliateDto } from './types'
import { isReservedPartnerCode } from './utils'

@Injectable()
export class AffiliateService {
  constructor(private prisma: PrismaService) {}

  async getAffiliates(): Promise<Affiliate[]> {
    return this.prisma.affiliate.findMany()
  }

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

  async createAffiliate(data: CreateAffiliateDto): Promise<Affiliate> {
    const { walletAddress, bps, partnerCode, receiveAddress } = data

    const existing = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (existing) throw new Error('Affiliate already registered')

    if (isReservedPartnerCode(partnerCode)) throw new Error('This partner code is reserved')

    const existingCode = await this.prisma.affiliate.findUnique({ where: { partnerCode } })
    if (existingCode) throw new Error('Partner code already taken')

    return this.prisma.affiliate.create({
      data: { walletAddress, receiveAddress, partnerCode, bps },
    })
  }

  async updateAffiliate(walletAddress: string, data: UpdateAffiliateDto): Promise<Affiliate> {
    const existing = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (!existing) throw new NotFoundException('Affiliate not found')

    const updateData: Prisma.AffiliateUpdateInput = {
      bps: data.bps ?? existing.bps,
      isActive: data.isActive ?? existing.isActive,
    }

    if (data.receiveAddress !== undefined) {
      updateData.receiveAddress = data.receiveAddress
    }

    return this.prisma.affiliate.update({ where: { walletAddress }, data: updateData })
  }

  async getAffiliateStats(
    partnerCode: string,
    options: { startDate?: Date; endDate?: Date },
  ): Promise<AffiliateStatsResult> {
    const { startDate, endDate } = options

    const items = await this.prisma.swap.findMany({
      where: {
        partnerCode,
        status: 'SUCCESS',
        isAffiliateVerified: true,
        ...(startDate || endDate
          ? {
              createdAt: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
          : {}),
      },
    })

    let totalSwaps = 0
    let totalVolumeUsd = 0
    let totalFeesEarnedUsd = 0

    for (const item of items) {
      const swap = toSwap(item)

      const fee = calculateFeeForSwap(swap)
      if (!fee) continue

      const rate = getPartnerFeeRate(fee.verifiedBps, swap.partnerBps)

      totalSwaps++
      totalVolumeUsd += fee.volumeUsd
      totalFeesEarnedUsd += fee.feeUsd * rate
    }

    return {
      totalSwaps,
      totalVolumeUsd: totalVolumeUsd.toFixed(2),
      totalFeesEarnedUsd: totalFeesEarnedUsd.toFixed(2),
    }
  }

  async getAffiliateSwaps(
    partnerCode: string | undefined,
    options: { startDate?: Date; endDate?: Date; limit: number; cursor?: string },
  ) {
    const { startDate, endDate, limit, cursor } = options

    const items = await this.prisma.swap.findMany({
      ...swapCursorArgs(limit, cursor),
      where: {
        partnerCode: partnerCode ?? { not: null },
        ...(startDate || endDate
          ? {
              createdAt: {
                ...(startDate && { gte: startDate }),
                ...(endDate && { lte: endDate }),
              },
            }
          : {}),
      },
    })

    const swaps = items.map((item) => {
      const swap = toSwap(item)
      const fee = calculateFeeForSwap(swap)
      const affiliateBps = fee?.verifiedBps ?? null
      const feeUsd = fee?.feeUsd ?? null
      const volumeUsd = fee?.volumeUsd ?? null
      const partnerFeeUsd = fee ? fee.feeUsd * getPartnerFeeRate(fee.verifiedBps, swap.partnerBps) : null
      return { ...swap, affiliateBps, feeUsd, partnerFeeUsd, volumeUsd }
    })

    return {
      swaps,
      nextCursor: getNextCursor(items, limit),
    }
  }

  async resolvePartnerCode(partnerCode: string) {
    const affiliate = await this.getAffiliateByPartnerCode(partnerCode)
    if (!affiliate) return null

    return {
      partnerBps: affiliate.bps,
      partnerCode: affiliate.partnerCode,
      partnerAddress: affiliate.receiveAddress ?? affiliate.walletAddress,
      shapeshiftBps: SHAPESHIFT_BPS,
    }
  }
}
