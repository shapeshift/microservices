import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Affiliate, AffiliateMember, Prisma } from '@prisma/client'

import { bnOrZero } from '@shapeshiftoss/chain-adapters'

import { PrismaService } from '../prisma/prisma.service'
import { SHAPESHIFT_BPS } from '../swaps/constants'
import { calculateFeeForSwap, getPartnerFeeUsd, toSwap } from '../swaps/utils'
import { getNextCursor, swapCursorArgs } from '../utils/pagination'

import type {
  AffiliateMemberResponse,
  AffiliateStatsResult,
  CreateAffiliateDto,
  ResolvedAffiliate,
  UpdateAffiliateDto,
} from './types'
import { isReservedPartnerCode, toChecksumAddress } from './utils'

@Injectable()
export class AffiliateService {
  constructor(private prisma: PrismaService) {}

  async getAffiliates(): Promise<Affiliate[]> {
    return this.prisma.affiliate.findMany()
  }

  // The registering wallet owns the affiliate; any wallet in affiliate_members is an admin of it
  async resolveAffiliateByWalletAddress(walletAddress: string): Promise<ResolvedAffiliate | null> {
    const owned = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (owned) return { affiliate: owned, role: 'owner' }

    const member = await this.prisma.affiliateMember.findUnique({
      where: { walletAddress },
      include: { affiliate: true },
    })
    if (member) return { affiliate: member.affiliate, role: 'admin' }

    return null
  }

  async getAffiliateByPartnerCode(partnerCode: string): Promise<Affiliate | null> {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { partnerCode } })
    if (!affiliate) return null
    return affiliate
  }

  async createAffiliate(data: CreateAffiliateDto): Promise<Affiliate> {
    const { bps, partnerCode } = data
    const walletAddress = toChecksumAddress(data.walletAddress)
    const receiveAddress = data.receiveAddress && toChecksumAddress(data.receiveAddress)

    const existing = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (existing) throw new Error('Affiliate already registered')

    const member = await this.prisma.affiliateMember.findUnique({ where: { walletAddress } })
    if (member) throw new Error('Wallet is already a member of a partner')

    if (isReservedPartnerCode(partnerCode)) throw new Error('This partner code is reserved')

    const existingCode = await this.prisma.affiliate.findUnique({ where: { partnerCode } })
    if (existingCode) throw new Error('Partner code already taken')

    return this.prisma.affiliate.create({
      data: { walletAddress, receiveAddress, partnerCode, bps },
    })
  }

  async updateAffiliate(id: string, data: UpdateAffiliateDto): Promise<Affiliate> {
    const existing = await this.prisma.affiliate.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('Affiliate not found')

    const updateData: Prisma.AffiliateUpdateInput = {
      bps: data.bps ?? existing.bps,
      isActive: data.isActive ?? existing.isActive,
    }

    if (data.receiveAddress !== undefined) {
      updateData.receiveAddress = toChecksumAddress(data.receiveAddress)
    }

    return this.prisma.affiliate.update({ where: { id }, data: updateData })
  }

  async getMembers(affiliate: Affiliate): Promise<AffiliateMemberResponse[]> {
    const members = await this.prisma.affiliateMember.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: 'asc' },
    })

    return [
      { walletAddress: affiliate.walletAddress, role: 'owner', addedBy: null, createdAt: affiliate.createdAt },
      ...members.map((m) => ({
        walletAddress: m.walletAddress,
        role: 'admin' as const,
        addedBy: m.addedBy,
        createdAt: m.createdAt,
      })),
    ]
  }

  // A wallet belongs to at most one affiliate across both tables so address lookups stay unambiguous
  async addMember(affiliate: Affiliate, rawWalletAddress: string, rawAddedBy: string): Promise<AffiliateMember> {
    const walletAddress = toChecksumAddress(rawWalletAddress)
    const addedBy = toChecksumAddress(rawAddedBy)

    const registered = await this.prisma.affiliate.findUnique({ where: { walletAddress } })
    if (registered?.id === affiliate.id) throw new ConflictException('Wallet is already the owner')
    if (registered) throw new ConflictException('Wallet is already registered as an affiliate')

    const existing = await this.prisma.affiliateMember.findUnique({ where: { walletAddress } })
    if (existing?.affiliateId === affiliate.id) throw new ConflictException('Wallet is already a member')
    if (existing) throw new ConflictException('Wallet is already a member of another partner')

    return this.prisma.affiliateMember.create({ data: { affiliateId: affiliate.id, walletAddress, addedBy } })
  }

  async removeMember(affiliate: Affiliate, walletAddress: string): Promise<void> {
    const member = await this.prisma.affiliateMember.findUnique({ where: { walletAddress } })
    if (member?.affiliateId !== affiliate.id) throw new NotFoundException('Member not found')

    await this.prisma.affiliateMember.delete({ where: { id: member.id } })
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
    let totalVolumeUsd = bnOrZero(0)
    let totalFeesEarnedUsd = bnOrZero(0)

    for (const item of items) {
      const swap = toSwap(item)

      const fee = calculateFeeForSwap(swap)
      if (!fee) continue

      totalSwaps++
      totalVolumeUsd = totalVolumeUsd.plus(fee.volumeUsd)
      totalFeesEarnedUsd = totalFeesEarnedUsd.plus(getPartnerFeeUsd(fee.feeUsd, fee.verifiedBps, swap.partnerBps))
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
      const feeUsd = fee ? fee.feeUsd.toString() : null
      const volumeUsd = fee ? fee.volumeUsd.toString() : null
      const partnerFeeUsd = fee ? getPartnerFeeUsd(fee.feeUsd, fee.verifiedBps, swap.partnerBps) : null
      return { ...swap, feeUsd, partnerFeeUsd, volumeUsd }
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
