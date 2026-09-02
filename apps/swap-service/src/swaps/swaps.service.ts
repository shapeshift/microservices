import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { CreateSwapDto, Fees, SwapStatusResponse, UpdateSwapStatusDto } from '@shapeshift/shared-types'
import { NotificationsServiceClient, UserServiceClient } from '@shapeshift/shared-utils'
import { swappers } from '@shapeshiftoss/swapper'
import { TxStatus } from '@shapeshiftoss/unchained-client'

import { CosmosSdkChainAdapterService } from '../lib/chain-adapters/cosmos-sdk.service'
import { EvmChainAdapterService } from '../lib/chain-adapters/evm.service'
import { NearChainAdapterService } from '../lib/chain-adapters/near.service'
import { SolanaChainAdapterService } from '../lib/chain-adapters/solana.service'
import { StarknetChainAdapterService } from '../lib/chain-adapters/starknet.service'
import { SuiChainAdapterService } from '../lib/chain-adapters/sui.service'
import { TonChainAdapterService } from '../lib/chain-adapters/ton.service'
import { TronChainAdapterService } from '../lib/chain-adapters/tron.service'
import { UtxoChainAdapterService } from '../lib/chain-adapters/utxo.service'
import { PrismaService } from '../prisma/prisma.service'
import { resolveAffiliateFeeAssetId } from '../utils/affiliateFeeAsset'
import { getNextCursor, swapCursorArgs } from '../utils/pagination'
import { SwapVerificationService } from '../verification/swap-verification.service'

import { REFERRER_FEE_RATE } from './constants'
import { buildChainAdapterAsserts, getSwapperConfig } from './swapper-config'
import type { AffiliateVerificationDetails, AggregateFeesParams, FeeTotals, PaginatedSwaps, Swap } from './types'
import { PaginationQueryDto } from './types'
import {
  buildStatusNotification,
  calculateFeeForSwap,
  computeSellAmountUsd,
  describeError,
  fetchUsdPrices,
  toQuotedAt,
  toSwap,
  toSwapperSwap,
} from './utils'

const logger = new Logger('SwapsService')

@Injectable()
export class SwapsService {
  private readonly notificationsClient: NotificationsServiceClient
  private readonly userServiceClient: UserServiceClient
  private readonly chainAdapterAsserts: ReturnType<typeof buildChainAdapterAsserts>

  constructor(
    private prisma: PrismaService,
    private swapVerificationService: SwapVerificationService,
    evmChainAdapterService: EvmChainAdapterService,
    utxoChainAdapterService: UtxoChainAdapterService,
    cosmosSdkChainAdapterService: CosmosSdkChainAdapterService,
    solanaChainAdapterService: SolanaChainAdapterService,
    tronChainAdapterService: TronChainAdapterService,
    suiChainAdapterService: SuiChainAdapterService,
    nearChainAdapterService: NearChainAdapterService,
    starknetChainAdapterService: StarknetChainAdapterService,
    tonChainAdapterService: TonChainAdapterService,
  ) {
    this.notificationsClient = new NotificationsServiceClient()
    this.userServiceClient = new UserServiceClient()
    this.chainAdapterAsserts = buildChainAdapterAsserts({
      evmChainAdapterService,
      utxoChainAdapterService,
      cosmosSdkChainAdapterService,
      solanaChainAdapterService,
      tronChainAdapterService,
      suiChainAdapterService,
      nearChainAdapterService,
      starknetChainAdapterService,
      tonChainAdapterService,
    })
  }

  async createSwap(data: CreateSwapDto): Promise<Swap> {
    try {
      const affiliateFeeAssetId = resolveAffiliateFeeAssetId(data.swapperName, data.sellAsset, data.buyAsset)

      const [referralCode, prices, partner] = await Promise.all([
        this.getReferralCode(data.userId),
        fetchUsdPrices(data, affiliateFeeAssetId),
        this.resolvePartner(data),
      ])

      const sellAmountUsd = computeSellAmountUsd(
        data.sellAmountCryptoBaseUnit,
        data.sellAsset.precision,
        prices.sellAssetUsd,
      )

      if (referralCode) logger.debug(`Found referral code ${referralCode} for user ${data.userId}`)

      const swap = toSwap(
        await this.prisma.swap.create({
          data: {
            swapId: data.swapId,
            sellAsset: data.sellAsset,
            buyAsset: data.buyAsset,
            sellTxHash: data.sellTxHash ?? null,
            sellAmountCryptoBaseUnit: data.sellAmountCryptoBaseUnit,
            expectedBuyAmountCryptoBaseUnit: data.expectedBuyAmountCryptoBaseUnit,
            source: data.source,
            swapperName: data.swapperName,
            sellAccountId: data.sellAccountId,
            buyAccountId: data.buyAccountId,
            receiveAddress: data.receiveAddress,
            isStreaming: data.isStreaming ?? false,
            metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
            userId: data.userId ?? 'api',
            referralCode,
            sellAssetUsd: prices.sellAssetUsd,
            buyAssetUsd: prices.buyAssetUsd,
            affiliateAssetUsd: prices.affiliateAssetUsd,
            partnerAddress: partner.partnerAddress,
            partnerCode: partner.partnerCode,
            partnerBps: data.partnerBps,
            affiliateBps: data.affiliateBps,
            shapeshiftBps: data.shapeshiftBps,
            origin: data.origin ?? null,
            quotedAt: toQuotedAt(data.quotedAt),
            affiliateFeeAssetId,
          },
        }),
      )

      logger.log(
        [
          `Swap created: ${swap.swapId}`,
          referralCode && `referral ${referralCode}`,
          (partner.partnerCode ?? partner.partnerAddress) && `partner ${partner.partnerCode ?? partner.partnerAddress}`,
          sellAmountUsd && `$${sellAmountUsd}`,
        ]
          .filter(Boolean)
          .join(' | '),
      )

      return swap
    } catch (error) {
      logger.error('Failed to create swap', error)
      throw error
    }
  }

  private async getReferralCode(userId: string | undefined): Promise<string | null> {
    if (!userId) return null
    return this.userServiceClient.getUserReferralCode(userId)
  }

  private async resolvePartner(
    data: CreateSwapDto,
  ): Promise<{ partnerCode: string | null; partnerAddress: string | null }> {
    if (data.partnerCode) {
      try {
        const affiliate = await this.prisma.affiliate.findUnique({
          where: { partnerCode: data.partnerCode },
          select: { partnerCode: true, receiveAddress: true, walletAddress: true, isActive: true },
        })

        if (affiliate && !affiliate.isActive) {
          logger.warn(`Refusing to attribute swap to deactivated partner ${data.partnerCode}`)
        }

        if (affiliate?.isActive) {
          return {
            partnerCode: affiliate.partnerCode,
            partnerAddress: affiliate.receiveAddress ?? affiliate.walletAddress,
          }
        }
      } catch (error) {
        logger.error(`Failed to resolve partner code ${data.partnerCode}:`, error)
        throw error
      }
    }

    if (data.partnerAddress) {
      try {
        const matches = await this.prisma.affiliate.findMany({
          where: {
            isActive: true,
            OR: [{ walletAddress: data.partnerAddress }, { receiveAddress: data.partnerAddress }],
          },
          select: { partnerCode: true },
          take: 2,
        })

        return {
          partnerCode: matches.length === 1 ? matches[0].partnerCode : null,
          partnerAddress: data.partnerAddress,
        }
      } catch (error) {
        logger.error(`Failed to resolve partner address ${data.partnerAddress}:`, error)
        throw error
      }
    }

    return { partnerCode: null, partnerAddress: null }
  }

  async updateSwapStatus(data: UpdateSwapStatusDto): Promise<Swap> {
    try {
      const swap = toSwap(
        await this.prisma.swap.update({
          where: { swapId: data.swapId },
          data: {
            status: data.status,
            sellTxHash: data.sellTxHash,
            buyTxHash: data.buyTxHash,
            txLink: data.txLink,
            statusMessage: data.statusMessage,
          },
        }),
      )

      try {
        await this.sendStatusUpdateNotification(swap)
      } catch (err) {
        logger.error(`Failed to send notification for swap ${swap.swapId}:`, err)
      }

      logger.log(`Swap status updated for swap: ${swap.swapId} (${swap.status})`)

      return swap
    } catch (error) {
      logger.error('Failed to update swap status', error)
      throw error
    }
  }

  private async sendStatusUpdateNotification(swap: Swap) {
    if (swap.userId === 'api') return

    const notification = buildStatusNotification(swap)
    if (!notification) return

    await this.notificationsClient.createNotification({
      ...notification,
      swapId: swap.swapId,
      userId: swap.userId,
    })
  }

  async getSwapById(swapId: string): Promise<Swap | null> {
    const prismaSwap = await this.prisma.swap.findUnique({ where: { swapId } })
    return prismaSwap ? toSwap(prismaSwap) : null
  }

  async getSwapsByUser(userId: string, options: PaginationQueryDto): Promise<PaginatedSwaps> {
    return this.paginateSwaps({ userId }, options)
  }

  async getSwapsByAccountId(accountId: string, options: PaginationQueryDto): Promise<PaginatedSwaps> {
    return this.paginateSwaps({ OR: [{ sellAccountId: accountId }, { buyAccountId: accountId }] }, options)
  }

  private async paginateSwaps(where: Prisma.SwapWhereInput, options: PaginationQueryDto): Promise<PaginatedSwaps> {
    const { limit, cursor } = options

    const rows = await this.prisma.swap.findMany({ where, ...swapCursorArgs(limit, cursor) })

    return { swaps: rows.map(toSwap), nextCursor: getNextCursor(rows, limit) }
  }

  async getPendingTxSwaps(): Promise<Swap[]> {
    const swaps = await this.prisma.swap.findMany({
      where: {
        sellTxHash: { not: null },
        status: { in: ['IDLE', 'PENDING'] },
      },
    })

    return swaps.map(toSwap)
  }

  async getPendingVerificationSwaps(): Promise<Swap[]> {
    const swaps = await this.prisma.swap.findMany({
      where: {
        sellTxHash: { not: null },
        verificationStatus: 'PENDING',
        status: { in: ['SUCCESS', 'FAILED'] },
      },
    })

    return swaps.map(toSwap)
  }

  async calculateReferralFees(referralCode: string, startDate?: Date, endDate?: Date): Promise<Fees> {
    logger.log(
      `Calculating referral fees for code: ${referralCode}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`,
    )

    const fees = await this.aggregateFees({
      baseWhere: { referralCode, isAffiliateVerified: true, status: 'SUCCESS', origin: 'web' },
      startDate,
      endDate,
      calcFee: (swap) => {
        const fee = calculateFeeForSwap(swap)
        if (!fee) return null
        return { feeUsd: fee.feeUsd * REFERRER_FEE_RATE, volumeUsd: fee.volumeUsd }
      },
    })

    logger.log(
      `Referral fees for ${referralCode}\n` +
        `  period:   ${fees.periodCount} swaps, $${fees.periodVolumeUsd.toFixed(2)} volume, $${fees.periodFeesUsd.toFixed(2)} fee\n` +
        `  all-time: ${fees.allTimeCount} swaps, $${fees.allTimeFeesUsd.toFixed(2)} fee`,
    )

    return {
      swapCount: fees.periodCount,
      periodVolumeUsd: fees.periodVolumeUsd.toFixed(2),
      periodFeeUsd: fees.periodFeesUsd.toFixed(2),
      allTimeFeeUsd: fees.allTimeFeesUsd.toFixed(2),
      periodStart: startDate?.toISOString(),
      periodEnd: endDate?.toISOString(),
    }
  }

  private async aggregateFees(params: AggregateFeesParams): Promise<FeeTotals> {
    const { baseWhere, startDate, endDate, calcFee } = params

    const rows = await this.prisma.swap.findMany({ where: baseWhere })

    const isInPeriod = (createdAt: Date): boolean => {
      if (startDate && createdAt < startDate) return false
      if (endDate && createdAt > endDate) return false
      return true
    }

    let periodCount = 0
    let periodVolumeUsd = 0
    let periodFeesUsd = 0
    let allTimeCount = 0
    let allTimeFeesUsd = 0

    for (const row of rows) {
      const swap = toSwap(row)

      const result = calcFee(swap)
      if (!result) continue

      allTimeCount += 1
      allTimeFeesUsd += result.feeUsd

      if (isInPeriod(swap.createdAt)) {
        periodCount += 1
        periodVolumeUsd += result.volumeUsd
        periodFeesUsd += result.feeUsd
      }
    }

    return {
      periodCount,
      periodVolumeUsd,
      periodFeesUsd,
      allTimeCount,
      allTimeFeesUsd,
    }
  }

  async checkSwapStatus(swapId: string): Promise<SwapStatusResponse> {
    const prismaSwap = await this.prisma.swap.findUnique({ where: { swapId } })
    if (!prismaSwap) throw new NotFoundException(`Swap not found: ${swapId}`)

    const swap = toSwap(prismaSwap)

    const swapper = swappers[swap.swapperName]
    if (!swapper) throw new InternalServerErrorException(`Swapper not registered: ${swap.swapperName}`)

    if (!swap.sellTxHash) throw new BadRequestException('Sell tx hash is required')

    try {
      const { status, buyTxHash, message } = await swapper.checkTradeStatus({
        txHash: swap.sellTxHash,
        chainId: swap.sellAsset.chainId,
        address: swap.sellAccountId,
        swap: toSwapperSwap(swap),
        stepIndex: swap.metadata.stepIndex,
        config: getSwapperConfig(),
        ...this.chainAdapterAsserts,
        fetchIsSmartContractAddressQuery: () => Promise.resolve(false),
      })

      const statusMessage = Array.isArray(message) ? message[0] : message

      return {
        status: status === TxStatus.Confirmed ? 'SUCCESS' : status === TxStatus.Failed ? 'FAILED' : 'PENDING',
        sellTxHash: swap.sellTxHash,
        buyTxHash,
        statusMessage: typeof statusMessage === 'string' ? statusMessage : '',
      }
    } catch (error) {
      const reason = describeError(error)

      logger.error(`Failed to check swap status for ${swapId}: ${reason}`)

      return {
        status: 'PENDING',
        statusMessage: `Error polling status: ${reason}`,
      }
    }
  }

  async verifySwap(swap: Swap): Promise<Swap> {
    if (swap.status === 'FAILED') {
      return toSwap(
        await this.prisma.swap.update({
          where: { swapId: swap.swapId },
          data: {
            verificationStatus: 'FAILED',
            isAffiliateVerified: false,
            affiliateVerificationDetails: Prisma.DbNull,
          },
        }),
      )
    }

    const verificationResult = await this.swapVerificationService.verifySwap(swap)
    if (verificationResult.verificationStatus === 'PENDING') return swap

    const isAffiliateVerified = verificationResult.verificationStatus === 'SUCCESS' && verificationResult.hasAffiliate

    const affiliateVerificationDetails: AffiliateVerificationDetails = {
      hasAffiliate: verificationResult.hasAffiliate,
      affiliateBps: verificationResult.affiliateBps,
      affiliateAddress: verificationResult.affiliateAddress,
      verifiedSellAmountCryptoBaseUnit: verificationResult.verifiedSellAmountCryptoBaseUnit,
    }

    return toSwap(
      await this.prisma.swap.update({
        where: { swapId: swap.swapId },
        data: {
          verificationStatus: verificationResult.verificationStatus,
          isAffiliateVerified,
          affiliateFeeAssetId: verificationResult.actualAffiliateFeeAssetId,
          affiliateAssetUsd: verificationResult.actualAffiliateFeeUsd,
          affiliateVerificationDetails: isAffiliateVerified ? affiliateVerificationDetails : Prisma.DbNull,
          actualBuyAmountCryptoBaseUnit: verificationResult.actualBuyAmountCryptoBaseUnit,
          actualAffiliateFeeAmountCryptoBaseUnit: verificationResult.actualAffiliateFeeAmountCryptoBaseUnit,
        },
      }),
    )
  }
}
