import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { CreateSwapDto, Fees, SwapStatusResponse, UpdateSwapStatusDto } from '@shapeshift/shared-types'
import { hashAccountId, NotificationsServiceClient, UserServiceClient } from '@shapeshift/shared-utils'
import { ChainId } from '@shapeshiftoss/caip'
import type { Swap as SwapperSwap } from '@shapeshiftoss/swapper'
import { SwapperName, swappers } from '@shapeshiftoss/swapper'
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

import type { AggregateFeesParams, FeeTotals, PaginatedSwaps, Swap } from './types'
import { PaginationQueryDto } from './types'
import { buildStatusNotification, calculateFeeForSwap, fetchUsdPrices, getAffiliateFeeRate, toSwap } from './utils'

const logger = new Logger('SwapsService')

@Injectable()
export class SwapsService {
  private readonly notificationsClient: NotificationsServiceClient
  private readonly userServiceClient: UserServiceClient

  private static readonly API_BASE_BPS = 10
  private static readonly REFERRER_FEE_RATE = 0.1

  constructor(
    private prisma: PrismaService,
    private evmChainAdapterService: EvmChainAdapterService,
    private utxoChainAdapterService: UtxoChainAdapterService,
    private cosmosSdkChainAdapterService: CosmosSdkChainAdapterService,
    private solanaChainAdapterService: SolanaChainAdapterService,
    private tronChainAdapterService: TronChainAdapterService,
    private suiChainAdapterService: SuiChainAdapterService,
    private nearChainAdapterService: NearChainAdapterService,
    private starknetChainAdapterService: StarknetChainAdapterService,
    private tonChainAdapterService: TonChainAdapterService,
    private swapVerificationService: SwapVerificationService,
  ) {
    this.notificationsClient = new NotificationsServiceClient()
    this.userServiceClient = new UserServiceClient()
  }

  async createSwap(data: CreateSwapDto): Promise<Swap> {
    try {
      const affiliateFeeAssetId = resolveAffiliateFeeAssetId(data.swapperName, data.sellAsset, data.buyAsset)

      const [referralCode, prices, affiliateAddress] = await Promise.all([
        this.getReferralCode(data.userId),
        fetchUsdPrices(data, affiliateFeeAssetId),
        this.resolveAffiliateAddress(data),
      ])

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
            sellAccountId: data.sellAccountId ? hashAccountId(data.sellAccountId) : 'api',
            buyAccountId: data.buyAccountId ? hashAccountId(data.buyAccountId) : null,
            receiveAddress: data.receiveAddress,
            isStreaming: data.isStreaming ?? false,
            metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
            userId: data.userId ?? 'api',
            referralCode,
            sellAmountUsd: prices.sellAmountUsd,
            buyAssetUsd: prices.buyAssetUsd,
            affiliateAssetUsd: prices.affiliateAssetUsd,
            affiliateAddress,
            affiliateBps: data.affiliateBps ?? null,
            origin: data.origin ?? null,
            shapeshiftBps: SwapsService.API_BASE_BPS,
            affiliateFeeAssetId,
          },
        }),
      )

      logger.log(
        [
          `Swap created: ${swap.swapId}`,
          referralCode && `referral ${referralCode}`,
          affiliateAddress && `affiliate ${affiliateAddress}`,
          prices.sellAmountUsd && `$${prices.sellAmountUsd}`,
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

  private async resolveAffiliateAddress(data: CreateSwapDto): Promise<string | null> {
    if (data.affiliateAddress) return data.affiliateAddress
    if (!data.partnerCode) return null

    try {
      const affiliate = await this.prisma.affiliate.findFirst({
        where: { partnerCode: data.partnerCode },
        select: { receiveAddress: true, walletAddress: true },
      })

      return affiliate?.receiveAddress ?? affiliate?.walletAddress ?? null
    } catch (error) {
      logger.warn(`Failed to resolve affiliate address for partner code ${data.partnerCode}:`, error)
      return null
    }
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
            actualBuyAmountCryptoBaseUnit: data.actualBuyAmountCryptoBaseUnit,
          },
        }),
      )

      try {
        await this.sendStatusUpdateNotification(swap)
      } catch (notifError) {
        logger.error(`Failed to send notification for swap ${swap.swapId}:`, notifError)
      }

      logger.log(`Swap status updated: ${swap.swapId} -> ${swap.status}`)

      return swap
    } catch (error) {
      logger.error('Failed to update swap status', error)
      throw error
    }
  }

  private async sendStatusUpdateNotification(swap: Swap) {
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
    const hashedAccountId = hashAccountId(accountId)

    return this.paginateSwaps({ OR: [{ sellAccountId: hashedAccountId }, { buyAccountId: hashedAccountId }] }, options)
  }

  private async paginateSwaps(where: Prisma.SwapWhereInput, options: PaginationQueryDto): Promise<PaginatedSwaps> {
    const { limit, cursor } = options

    const rows = await this.prisma.swap.findMany({ where, ...swapCursorArgs(limit, cursor) })

    return { items: rows.map(toSwap), nextCursor: getNextCursor(rows, limit) }
  }

  async getPendingSwaps(): Promise<Swap[]> {
    const swaps = await this.prisma.swap.findMany({
      where: { status: { in: ['IDLE', 'PENDING'] }, sellTxHash: { not: null } },
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
        return { feeUsd: fee.feeUsd * SwapsService.REFERRER_FEE_RATE, volumeUsd: fee.volumeUsd }
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

  async calculateAffiliateFees(affiliateAddress: string, startDate?: Date, endDate?: Date): Promise<Fees> {
    logger.log(
      `Calculating affiliate fees for address: ${affiliateAddress}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`,
    )

    const fees = await this.aggregateFees({
      baseWhere: { affiliateAddress, isAffiliateVerified: true, status: 'SUCCESS', origin: 'api' },
      startDate,
      endDate,
      calcFee: (swap) => {
        const fee = calculateFeeForSwap(swap)
        if (!fee) return null
        const rate = getAffiliateFeeRate(fee.verifiedBps, swap.shapeshiftBps)
        return { feeUsd: fee.feeUsd * rate, volumeUsd: fee.volumeUsd }
      },
    })

    logger.log(
      `Affiliate fees for ${affiliateAddress}\n` +
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

  async pollSwapStatus(swapId: string): Promise<SwapStatusResponse> {
    try {
      logger.log(`Polling status for swap: ${swapId}`)

      const rawSwap = await this.prisma.swap.findUnique({
        where: { swapId },
      })

      if (!rawSwap) {
        throw new Error(`Swap not found: ${swapId}`)
      }

      const swap = toSwap(rawSwap)

      const swapper = swappers[swap.swapperName as SwapperName]

      if (!swapper) {
        throw new Error(`Swapper not found: ${swap.swapperName}`)
      }

      if (!swap.sellTxHash) {
        throw new Error('Sell tx hash is required')
      }

      const status = await swapper.checkTradeStatus({
        txHash: swap.sellTxHash ?? '',
        chainId: swap.sellAsset.chainId,
        address: swap.sellAccountId,
        swap: {
          ...swap,
          id: swap.swapId,
          createdAt: swap.createdAt.getTime(),
          updatedAt: swap.updatedAt.getTime(),
        } as unknown as SwapperSwap,
        stepIndex: swap.metadata.stepIndex,
        config: {
          VITE_UNCHAINED_THORCHAIN_HTTP_URL: process.env.VITE_UNCHAINED_THORCHAIN_HTTP_URL || '',
          VITE_UNCHAINED_MAYACHAIN_HTTP_URL: process.env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL || '',
          VITE_UNCHAINED_COSMOS_HTTP_URL: process.env.VITE_UNCHAINED_COSMOS_HTTP_URL || '',
          VITE_THORCHAIN_NODE_URL: process.env.VITE_THORCHAIN_NODE_URL || '',
          VITE_MAYACHAIN_NODE_URL: process.env.VITE_MAYACHAIN_NODE_URL || '',
          VITE_COWSWAP_BASE_URL: process.env.VITE_COWSWAP_BASE_URL || '',
          VITE_CHAINFLIP_API_KEY: process.env.VITE_CHAINFLIP_API_KEY || '',
          VITE_CHAINFLIP_API_URL: process.env.VITE_CHAINFLIP_API_URL || '',
          VITE_RELAY_API_URL: process.env.VITE_RELAY_API_URL || '',
          VITE_PORTALS_BASE_URL: process.env.VITE_PORTALS_BASE_URL || '',
          VITE_ZRX_BASE_URL: process.env.VITE_ZRX_BASE_URL || '',
          VITE_THORCHAIN_MIDGARD_URL: process.env.VITE_THORCHAIN_MIDGARD_URL || '',
          VITE_MAYACHAIN_MIDGARD_URL: process.env.VITE_MAYACHAIN_MIDGARD_URL || '',
          VITE_UNCHAINED_BITCOIN_HTTP_URL: process.env.VITE_UNCHAINED_BITCOIN_HTTP_URL || '',
          VITE_UNCHAINED_DOGECOIN_HTTP_URL: process.env.VITE_UNCHAINED_DOGECOIN_HTTP_URL || '',
          VITE_UNCHAINED_LITECOIN_HTTP_URL: process.env.VITE_UNCHAINED_LITECOIN_HTTP_URL || '',
          VITE_UNCHAINED_BITCOINCASH_HTTP_URL: process.env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL || '',
          VITE_UNCHAINED_ETHEREUM_HTTP_URL: process.env.VITE_UNCHAINED_ETHEREUM_HTTP_URL || '',
          VITE_UNCHAINED_AVALANCHE_HTTP_URL: process.env.VITE_UNCHAINED_AVALANCHE_HTTP_URL || '',
          VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL: process.env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL || '',
          VITE_UNCHAINED_BASE_HTTP_URL: process.env.VITE_UNCHAINED_BASE_HTTP_URL || '',
          VITE_NEAR_INTENTS_API_KEY: process.env.VITE_NEAR_INTENTS_API_KEY || '',
          VITE_BEBOP_API_KEY: process.env.VITE_BEBOP_API_KEY || '',
          VITE_TENDERLY_API_KEY: process.env.VITE_TENDERLY_API_KEY || '',
          VITE_TENDERLY_ACCOUNT_SLUG: process.env.VITE_TENDERLY_ACCOUNT_SLUG || '',
          VITE_TENDERLY_PROJECT_SLUG: process.env.VITE_TENDERLY_PROJECT_SLUG || '',
          VITE_TRON_NODE_URL: process.env.VITE_TRON_NODE_URL || '',
          VITE_SUI_NODE_URL: process.env.VITE_SUI_NODE_URL || '',
          VITE_ACROSS_API_URL: process.env.VITE_ACROSS_API_URL || '',
          VITE_ACROSS_INTEGRATOR_ID: process.env.VITE_ACROSS_INTEGRATOR_ID || '',
          VITE_DEBRIDGE_API_URL: process.env.VITE_DEBRIDGE_API_URL || '',
          VITE_FEATURE_THORCHAINSWAP_LONGTAIL: true,
          VITE_FEATURE_THORCHAINSWAP_L1_TO_LONGTAIL: true,
          VITE_FEATURE_CHAINFLIP_SWAP_DCA: true,
        },
        assertGetSolanaChainAdapter: (chainId: ChainId) => {
          return this.solanaChainAdapterService.assertGetSolanaChainAdapter(chainId)
        },
        assertGetUtxoChainAdapter: (chainId: ChainId) => {
          return this.utxoChainAdapterService.assertGetUtxoChainAdapter(chainId)
        },
        assertGetCosmosSdkChainAdapter: (chainId: ChainId) => {
          return this.cosmosSdkChainAdapterService.assertGetCosmosSdkChainAdapter(chainId)
        },
        assertGetEvmChainAdapter: (chainId: ChainId) => {
          return this.evmChainAdapterService.assertGetEvmChainAdapter(chainId)
        },
        assertGetTronChainAdapter: (chainId: ChainId) => {
          return this.tronChainAdapterService.assertGetTronChainAdapter(chainId)
        },
        assertGetSuiChainAdapter: (chainId: ChainId) => {
          return this.suiChainAdapterService.assertGetSuiChainAdapter(chainId)
        },
        assertGetNearChainAdapter: (chainId: ChainId) => {
          return this.nearChainAdapterService.assertGetNearChainAdapter(chainId)
        },
        assertGetStarknetChainAdapter: (chainId: ChainId) => {
          return this.starknetChainAdapterService.assertGetStarknetChainAdapter(chainId)
        },
        assertGetTonChainAdapter: (chainId: ChainId) => {
          return this.tonChainAdapterService.assertGetTonChainAdapter(chainId)
        },
        fetchIsSmartContractAddressQuery: () => Promise.resolve(false),
      })

      // Verify affiliate usage
      let isAffiliateVerified: boolean | undefined
      let affiliateVerificationDetails:
        | {
            hasAffiliate: boolean
            affiliateBps?: number
            affiliateAddress?: string
            verifiedSellAmountCryptoBaseUnit?: string
          }
        | undefined

      try {
        const enrichedMetadata = {
          ...(swap.metadata as Record<string, any>),
          receiveAddress: swap.receiveAddress,
          expectedBuyAmountCryptoBaseUnit: swap.expectedBuyAmountCryptoBaseUnit,
          createdAt: swap.createdAt.getTime(),
          sellAssetPrecision: swap.sellAsset.precision,
          affiliateBps: swap.affiliateBps,
          affiliateAddress: swap.affiliateAddress,
          integratorFeeRecipient: swap.affiliateAddress,
          sellAmountCryptoBaseUnit: swap.sellAmountCryptoBaseUnit,
        }

        const verificationResult = await this.swapVerificationService.verifySwapAffiliate(
          swapId,
          swap.swapperName,
          swap.sellAsset.chainId,
          swap.sellTxHash || undefined,
          enrichedMetadata,
        )

        isAffiliateVerified = verificationResult.isVerified && verificationResult.hasAffiliate

        if (verificationResult.isVerified) {
          affiliateVerificationDetails = {
            hasAffiliate: verificationResult.hasAffiliate,
            affiliateBps: verificationResult.affiliateBps,
            affiliateAddress: verificationResult.affiliateAddress,
            verifiedSellAmountCryptoBaseUnit: verificationResult.verifiedSellAmountCryptoBaseUnit,
          }
        }

        logger.log(
          `Affiliate verification for swap ${swapId}: verified=${verificationResult.isVerified}, hasAffiliate=${verificationResult.hasAffiliate}`,
        )

        await this.prisma.swap.update({
          where: { swapId },
          data: {
            isAffiliateVerified,
            affiliateVerificationDetails: affiliateVerificationDetails || {},
          },
        })
      } catch (verificationError) {
        logger.warn(`Failed to verify affiliate for swap ${swapId}:`, verificationError)
      }

      return {
        status:
          status.status === TxStatus.Confirmed ? 'SUCCESS' : status.status === TxStatus.Failed ? 'FAILED' : 'PENDING',
        sellTxHash: swap.sellTxHash,
        buyTxHash: status.buyTxHash,
        statusMessage:
          typeof status.message === 'string' ? status.message : Array.isArray(status.message) ? status.message[0] : '',
        isAffiliateVerified,
        affiliateVerificationDetails,
      }
    } catch (error) {
      logger.error(`Failed to poll swap status for ${swapId}:`, error)
      return {
        status: 'PENDING',
        statusMessage: `Error polling status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }
}
