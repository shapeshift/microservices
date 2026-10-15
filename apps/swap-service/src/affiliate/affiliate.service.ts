import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Affiliate, Prisma } from '@prisma/client'
import { getAddress } from 'viem'

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
import { isReservedPartnerCode } from './utils'

// Advisory lock namespaces, always taken in this order so two registrations cannot deadlock
const WALLET_LOCK = 1
const PARTNER_CODE_LOCK = 2

type Claims = { walletAddress: string; partnerCode?: string }

@Injectable()
export class AffiliateService {
  constructor(private prisma: PrismaService) {}

  // Serializes every write that claims a wallet or partner code so the uniqueness checks cannot race.
  // $executeRaw because the lock function returns void, which $queryRaw cannot deserialize
  private async withClaimLocks<T>(claims: Claims, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WALLET_LOCK}::int, hashtext(${claims.walletAddress.toLowerCase()}))`
      if (claims.partnerCode) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PARTNER_CODE_LOCK}::int, hashtext(${claims.partnerCode.toLowerCase()}))`
      }
      return fn(tx)
    })
  }

  async getAffiliates(): Promise<Affiliate[]> {
    return this.prisma.affiliate.findMany()
  }

  // The registering wallet owns the affiliate; any wallet in affiliate_members is an admin of it
  async resolveAffiliateByWalletAddress(
    walletAddress: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<ResolvedAffiliate | null> {
    const affiliate = await client.affiliate.findFirst({
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
    const walletAddress = getAddress(data.walletAddress)
    const receiveAddress = data.receiveAddress && getAddress(data.receiveAddress)

    if (isReservedPartnerCode(partnerCode)) throw new BadRequestException('This partner code is reserved')

    return this.withClaimLocks({ walletAddress, partnerCode }, async (tx) => {
      const claimed = await this.resolveAffiliateByWalletAddress(walletAddress, tx)
      if (claimed?.role === 'owner') throw new ConflictException('Affiliate already registered')
      if (claimed) throw new ConflictException('Wallet is already a member of a partner')

      const existingCode = await tx.affiliate.findUnique({ where: { partnerCode } })
      if (existingCode) throw new ConflictException('Partner code already taken')

      return tx.affiliate.create({ data: { walletAddress, receiveAddress, partnerCode, bps } })
    })
  }

  // isActive is not updatable here; only ShapeShift deactivates a partner
  async updateAffiliate(affiliate: Affiliate, data: UpdateAffiliateDto): Promise<Affiliate> {
    const updateData: Prisma.AffiliateUpdateInput = {}

    if (data.bps !== undefined) updateData.bps = data.bps
    // null clears the override so payouts fall back to walletAddress
    if (data.receiveAddress !== undefined) {
      updateData.receiveAddress = data.receiveAddress && getAddress(data.receiveAddress)
    }

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
  async addMember(affiliate: Affiliate, data: { walletAddress: string; addedBy: string }): Promise<void> {
    const walletAddress = getAddress(data.walletAddress)
    const addedBy = getAddress(data.addedBy)

    await this.withClaimLocks({ walletAddress }, async (tx) => {
      const claimed = await this.resolveAffiliateByWalletAddress(walletAddress, tx)
      if (claimed) {
        const here = claimed.affiliate.id === affiliate.id
        if (claimed.role === 'owner') {
          throw new ConflictException(
            here ? 'Wallet is already the owner' : 'Wallet is already registered as an affiliate',
          )
        }
        throw new ConflictException(
          here ? 'Wallet is already a member' : 'Wallet is already a member of another partner',
        )
      }

      await tx.affiliateMember.create({ data: { affiliateId: affiliate.id, walletAddress, addedBy } })
    })
  }

  async removeMember(affiliate: Affiliate, walletAddress: string): Promise<void> {
    const { count } = await this.prisma.affiliateMember.deleteMany({
      where: { walletAddress, affiliateId: affiliate.id },
    })
    if (count === 0) throw new NotFoundException('Member not found')
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
