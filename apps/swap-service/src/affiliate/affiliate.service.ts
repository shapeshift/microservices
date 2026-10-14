import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
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

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'

@Injectable()
export class AffiliateService {
  constructor(private prisma: PrismaService) {}

  // Serializes every write that claims a wallet so the owner/member exclusivity check cannot race
  private async withWalletLock<T>(walletAddress: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${walletAddress.toLowerCase()}))`
      return fn(tx)
    })
  }

  async getAffiliates(): Promise<Affiliate[]> {
    return this.prisma.affiliate.findMany()
  }

  // The registering wallet owns the affiliate; any wallet in affiliate_members is an admin of it
  async resolveAffiliateByWalletAddress(walletAddress: string): Promise<ResolvedAffiliate | null> {
    const affiliate = await this.prisma.affiliate.findFirst({
      where: { OR: [{ walletAddress }, { members: { some: { walletAddress } } }] },
    })
    if (!affiliate) return null

    const role = affiliate.walletAddress.toLowerCase() === walletAddress.toLowerCase() ? 'owner' : 'admin'
    return { affiliate, role }
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

    if (isReservedPartnerCode(partnerCode)) throw new BadRequestException('This partner code is reserved')

    return this.withWalletLock(walletAddress, async (tx) => {
      const existing = await tx.affiliate.findUnique({ where: { walletAddress } })
      if (existing) throw new ConflictException('Affiliate already registered')

      const member = await tx.affiliateMember.findUnique({ where: { walletAddress } })
      if (member) throw new ConflictException('Wallet is already a member of a partner')

      const existingCode = await tx.affiliate.findUnique({ where: { partnerCode } })
      if (existingCode) throw new ConflictException('Partner code already taken')

      try {
        return await tx.affiliate.create({ data: { walletAddress, receiveAddress, partnerCode, bps } })
      } catch (error) {
        // Two registrations racing on the same code are not covered by the wallet lock
        if (isUniqueViolation(error)) throw new ConflictException('Partner code already taken')
        throw error
      }
    })
  }

  // isActive is deliberately not updatable here; only ShapeShift deactivates a partner
  async updateAffiliate(affiliate: Affiliate, data: UpdateAffiliateDto): Promise<Affiliate> {
    const updateData: Prisma.AffiliateUpdateInput = {}

    if (data.bps !== undefined) updateData.bps = data.bps
    if (data.receiveAddress !== undefined) updateData.receiveAddress = toChecksumAddress(data.receiveAddress)

    return this.prisma.affiliate.update({ where: { id: affiliate.id }, data: updateData })
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

    return this.withWalletLock(walletAddress, async (tx) => {
      const registered = await tx.affiliate.findUnique({ where: { walletAddress } })
      if (registered?.id === affiliate.id) throw new ConflictException('Wallet is already the owner')
      if (registered) throw new ConflictException('Wallet is already registered as an affiliate')

      const existing = await tx.affiliateMember.findUnique({ where: { walletAddress } })
      if (existing?.affiliateId === affiliate.id) throw new ConflictException('Wallet is already a member')
      if (existing) throw new ConflictException('Wallet is already a member of another partner')

      return tx.affiliateMember.create({ data: { affiliateId: affiliate.id, walletAddress, addedBy } })
    })
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
