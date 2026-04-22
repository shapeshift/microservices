import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { CreateSwapDto, SwapStatusResponse, UpdateSwapStatusDto } from '@shapeshift/shared-types'
import {
  baseUnitToPrecision,
  hashAccountId,
  NotificationsServiceClient,
  UserServiceClient,
} from '@shapeshift/shared-utils'
import { ChainId } from '@shapeshiftoss/caip'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { Swap as SwapperSwap } from '@shapeshiftoss/swapper'
import { SwapperName, swappers } from '@shapeshiftoss/swapper'
import { Asset } from '@shapeshiftoss/types'
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
import { getAssetPriceUsd } from '../utils/pricing'
import { SwapVerificationService } from '../verification/swap-verification.service'

import type { AffiliateVerificationDetails, PaginationOptions, Swap, UsdPrices } from './types'
import {
  estimateAffiliateFeeAmount,
  formatAmount,
  getAffiliateCommissionRate,
  resolveFeeAssetPrice,
  toSwap,
} from './utils'

@Injectable()
export class SwapsService {
  private readonly logger = new Logger(SwapsService.name)
  private readonly notificationsClient: NotificationsServiceClient
  private readonly userServiceClient: UserServiceClient

  private static readonly API_BASE_BPS = 10

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
        this.fetchUsdPrices(data, affiliateFeeAssetId),
        this.resolveAffiliateAddress(data),
      ])

      if (referralCode) this.logger.debug(`Found referral code ${referralCode} for user ${data.userId}`)

      const swap = await this.prisma.swap.create({
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
      })

      this.logger.log(
        [
          `Swap created: ${swap.swapId}`,
          referralCode && `referral ${referralCode}`,
          affiliateAddress && `affiliate ${affiliateAddress}`,
          prices.sellAmountUsd && `$${prices.sellAmountUsd}`,
        ]
          .filter(Boolean)
          .join(' | '),
      )

      return toSwap(swap)
    } catch (error) {
      this.logger.error('Failed to create swap', error)
      throw error
    }
  }

  private async getReferralCode(userId: string | undefined): Promise<string | null> {
    if (!userId) return null
    return this.userServiceClient.getUserReferralCode(userId)
  }

  private async fetchUsdPrices(data: CreateSwapDto, affiliateFeeAssetId: string | null): Promise<UsdPrices> {
    try {
      const [sellAssetUsd, buyAssetUsd, affiliateAssetUsd] = await Promise.all([
        getAssetPriceUsd(data.sellAsset.assetId),
        getAssetPriceUsd(data.buyAsset.assetId),
        affiliateFeeAssetId ? getAssetPriceUsd(affiliateFeeAssetId) : Promise.resolve<number | null>(null),
      ])

      const sellAmountUsd = sellAssetUsd
        ? bnOrZero(baseUnitToPrecision(data.sellAmountCryptoBaseUnit, data.sellAsset.precision))
            .times(sellAssetUsd)
            .toFixed(2)
        : null

      return {
        sellAmountUsd,
        buyAssetUsd: buyAssetUsd?.toString() ?? null,
        affiliateAssetUsd: affiliateAssetUsd?.toString() ?? null,
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch USD prices for swap ${data.swapId}:`, err)
      return { sellAmountUsd: null, buyAssetUsd: null, affiliateAssetUsd: null }
    }
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
      this.logger.warn(`Failed to resolve affiliate address for partner code ${data.partnerCode}:`, error)
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
        this.logger.error(`Failed to send notification for swap ${swap.swapId}:`, notifError)
      }

      this.logger.log(`Swap status updated: ${swap.swapId} -> ${swap.status}`)

      return swap
    } catch (error) {
      this.logger.error('Failed to update swap status', error)
      throw error
    }
  }

  private async sendStatusUpdateNotification(
    swap: Pick<
      Swap,
      | 'swapId'
      | 'userId'
      | 'status'
      | 'sellAsset'
      | 'buyAsset'
      | 'sellAmountCryptoBaseUnit'
      | 'actualBuyAmountCryptoBaseUnit'
      | 'expectedBuyAmountCryptoBaseUnit'
    >,
  ) {
    let title: string
    let body: string
    let type: 'SWAP_STATUS_UPDATE' | 'SWAP_COMPLETED' | 'SWAP_FAILED'

    const { sellAsset, buyAsset } = swap

    switch (swap.status) {
      case 'SUCCESS': {
        title = 'Swap Completed!'
        const sellAmount = formatAmount(baseUnitToPrecision(swap.sellAmountCryptoBaseUnit, sellAsset.precision))
        const buyAmount = formatAmount(
          baseUnitToPrecision(
            swap.actualBuyAmountCryptoBaseUnit || swap.expectedBuyAmountCryptoBaseUnit,
            buyAsset.precision,
          ),
        )
        body = `Your swap of ${sellAmount} ${sellAsset.symbol} to ${buyAmount} ${buyAsset.symbol} is complete.`
        type = 'SWAP_COMPLETED'
        break
      }
      case 'FAILED':
        title = 'Swap Failed'
        body = `Your ${sellAsset.symbol} to ${buyAsset.symbol} swap has failed`
        type = 'SWAP_FAILED'
        break
      default:
        return
    }

    if (swap.status === 'FAILED' || swap.status === 'SUCCESS') {
      await this.notificationsClient.createNotification({
        userId: swap.userId,
        title,
        body,
        type,
        swapId: swap.swapId,
      })
    }
  }

  async getSwapsByUser(userId: string, options: PaginationOptions = {}) {
    return this.paginateSwaps({ userId }, options)
  }

  async getSwapsByAccountId(accountId: string, options: PaginationOptions = {}) {
    const hashedAccountId = hashAccountId(accountId)

    return this.paginateSwaps(
      {
        OR: [{ sellAccountId: hashedAccountId }, { buyAccountId: hashedAccountId }],
      },
      options,
    )
  }

  private async paginateSwaps(where: Prisma.SwapWhereInput, { limit = 50, cursor }: PaginationOptions) {
    const items = await this.prisma.swap.findMany({ where, ...swapCursorArgs(limit, cursor) })

    return { items, nextCursor: getNextCursor(items, limit) }
  }

  async getPendingSwaps(): Promise<Swap[]> {
    const swaps = await this.prisma.swap.findMany({
      where: {
        status: {
          in: ['IDLE', 'PENDING'],
        },
        sellTxHash: { not: null },
      },
    })

    return swaps.map(toSwap)
  }

  async calculateReferralFees(referralCode: string, startDate?: Date, endDate?: Date) {
    this.logger.log(
      `Calculating referral fees for code: ${referralCode}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`,
    )

    const periodWhereClause: Prisma.SwapWhereInput = {
      referralCode,
      isAffiliateVerified: true,
      status: 'SUCCESS',
    }

    if (startDate && endDate) {
      periodWhereClause.createdAt = { gte: startDate, lte: endDate }
    }

    const referralSwapSelect = {
      swapId: true,
      sellAmountUsd: true,
      affiliateVerificationDetails: true,
      createdAt: true,
    } as const

    const periodSwaps = await this.prisma.swap.findMany({
      where: periodWhereClause,
      select: referralSwapSelect,
    })

    const allTimeSwaps = await this.prisma.swap.findMany({
      where: {
        referralCode,
        isAffiliateVerified: true,
        status: 'SUCCESS',
      },
      select: referralSwapSelect,
    })

    this.logger.log(
      `Found ${periodSwaps.length} swaps for period, ${allTimeSwaps.length} swaps all-time for referral code ${referralCode}`,
    )

    const sumFees = (swaps: typeof periodSwaps) => {
      let totalFeesUsd = 0
      let totalVolumeUsd = 0
      for (const swap of swaps) {
        const sellAmountUsd = this.resolveSwapSellAmountUsd(swap)
        if (sellAmountUsd === null) continue
        totalVolumeUsd += sellAmountUsd
        const details = swap.affiliateVerificationDetails as AffiliateVerificationDetails | null
        const bps = details?.affiliateBps
        if (bps && sellAmountUsd > 0) {
          totalFeesUsd += (sellAmountUsd * bps) / 10000
        }
      }
      return { totalFeesUsd, totalVolumeUsd }
    }

    const period = sumFees(periodSwaps)
    const allTime = sumFees(allTimeSwaps)

    // Referrer receives 10% of affiliate fees collected.
    const periodReferrerCommissionUsd = period.totalFeesUsd * 0.1
    const allTimeReferrerCommissionUsd = allTime.totalFeesUsd * 0.1

    this.logger.log(
      `Referral fee calculation for ${referralCode}: ` +
        `Period: ${periodSwaps.length} swaps, $${period.totalVolumeUsd.toFixed(2)} volume, $${periodReferrerCommissionUsd.toFixed(2)} commission | ` +
        `All-time: ${allTimeSwaps.length} swaps, $${allTimeReferrerCommissionUsd.toFixed(2)} total commission`,
    )

    return {
      referralCode,
      swapCount: periodSwaps.length,
      totalSwapVolumeUsd: period.totalVolumeUsd.toFixed(2),
      totalFeesCollectedUsd: allTimeReferrerCommissionUsd.toFixed(2),
      referrerCommissionUsd: periodReferrerCommissionUsd.toFixed(2),
      periodStart: startDate?.toISOString(),
      periodEnd: endDate?.toISOString(),
    }
  }

  private resolveSwapSellAmountUsd(swap: { swapId: string; sellAmountUsd: string | null }): number | null {
    if (!swap.sellAmountUsd) {
      this.logger.warn(`Missing sellAmountUsd for swap ${swap.swapId}, skipping`)
      return null
    }
    return parseFloat(swap.sellAmountUsd)
  }

  async calculateAffiliateFees(affiliateAddress: string, startDate?: Date, endDate?: Date) {
    const normalizedAddress = affiliateAddress.toLowerCase()

    this.logger.log(
      `Calculating affiliate fees for address: ${normalizedAddress}, period: ${startDate?.toISOString()} - ${endDate?.toISOString()}`,
    )

    const periodWhereClause: Prisma.SwapWhereInput = {
      affiliateAddress: normalizedAddress,
      isAffiliateVerified: true,
      status: 'SUCCESS',
    }

    if (startDate && endDate) {
      periodWhereClause.createdAt = { gte: startDate, lte: endDate }
    }

    const swapSelect = {
      swapId: true,
      swapperName: true,
      sellAsset: true,
      buyAsset: true,
      sellAmountCryptoBaseUnit: true,
      expectedBuyAmountCryptoBaseUnit: true,
      sellAmountUsd: true,
      buyAssetUsd: true,
      affiliateAssetUsd: true,
      affiliateBps: true,
      origin: true,
      affiliateFeeAssetId: true,
      actualAffiliateFeeAmountCryptoBaseUnit: true,
      affiliateVerificationDetails: true,
      createdAt: true,
      shapeshiftBps: true,
    } as const

    const periodSwaps = await this.prisma.swap.findMany({
      where: periodWhereClause,
      select: swapSelect,
    })

    const allTimeSwaps = await this.prisma.swap.findMany({
      where: {
        affiliateAddress: normalizedAddress,
        isAffiliateVerified: true,
        status: 'SUCCESS',
      },
      select: swapSelect,
    })

    this.logger.log(
      `Found ${periodSwaps.length} swaps for period, ${allTimeSwaps.length} swaps all-time for affiliate ${normalizedAddress}`,
    )

    let periodCommissionUsd = 0
    let totalSwapVolumeUsd = 0
    for (const swap of periodSwaps) {
      const { feeUsd, volumeUsd } = this.calculateFeeForSwap(swap)
      totalSwapVolumeUsd += volumeUsd
      periodCommissionUsd += feeUsd
    }

    let allTimeCommissionUsd = 0
    for (const swap of allTimeSwaps) {
      const { feeUsd } = this.calculateFeeForSwap(swap)
      allTimeCommissionUsd += feeUsd
    }

    this.logger.log(
      `Affiliate fee calculation for ${normalizedAddress}: ` +
        `Period: ${periodSwaps.length} swaps, $${totalSwapVolumeUsd.toFixed(2)} volume, $${periodCommissionUsd.toFixed(2)} commission | ` +
        `All-time: ${allTimeSwaps.length} swaps, $${allTimeCommissionUsd.toFixed(2)} total commission`,
    )

    return {
      affiliateAddress: normalizedAddress,
      swapCount: periodSwaps.length,
      totalSwapVolumeUsd: totalSwapVolumeUsd.toFixed(2),
      totalFeesCollectedUsd: allTimeCommissionUsd.toFixed(2),
      referrerCommissionUsd: periodCommissionUsd.toFixed(2),
      periodStart: startDate?.toISOString(),
      periodEnd: endDate?.toISOString(),
    }
  }

  private calculateFeeForSwap(swap: {
    swapId: string
    swapperName: string
    sellAsset: unknown
    buyAsset: unknown
    sellAmountCryptoBaseUnit: string
    expectedBuyAmountCryptoBaseUnit: string
    sellAmountUsd: string | null
    buyAssetUsd: string | null
    affiliateAssetUsd: string | null
    affiliateBps: number | null
    origin: string | null
    affiliateFeeAssetId: string | null
    actualAffiliateFeeAmountCryptoBaseUnit: string | null
    affiliateVerificationDetails: unknown
    shapeshiftBps: number
  }): { feeUsd: number; volumeUsd: number } {
    const sellAmountUsd = this.resolveSwapSellAmountUsd(swap)
    if (sellAmountUsd === null) return { feeUsd: 0, volumeUsd: 0 }

    const verificationDetails = swap.affiliateVerificationDetails as AffiliateVerificationDetails | null
    const verifiedBps = verificationDetails?.affiliateBps ?? swap.affiliateBps ?? undefined

    if (!verifiedBps || sellAmountUsd <= 0) {
      return { feeUsd: 0, volumeUsd: sellAmountUsd }
    }

    const commissionRate = getAffiliateCommissionRate(swap.origin, verifiedBps, swap.shapeshiftBps)

    const verifiedSell = verificationDetails?.verifiedSellAmountCryptoBaseUnit
    const effectiveSellAmount = verifiedSell
      ? bnOrZero(verifiedSell).lt(bnOrZero(swap.sellAmountCryptoBaseUnit))
        ? verifiedSell
        : swap.sellAmountCryptoBaseUnit
      : swap.sellAmountCryptoBaseUnit

    let totalFeeUsd: number
    const feeAssetId = swap.affiliateFeeAssetId
    const feeAssetPrice = resolveFeeAssetPrice(swap)

    if (feeAssetId && feeAssetPrice) {
      const sellAssetObj = swap.sellAsset as Asset
      const buyAssetObj = swap.buyAsset as Asset
      const feeAmountBaseUnit =
        swap.actualAffiliateFeeAmountCryptoBaseUnit ??
        estimateAffiliateFeeAmount(
          verifiedBps,
          swap.swapperName,
          effectiveSellAmount,
          swap.expectedBuyAmountCryptoBaseUnit,
        )
      const feeAssetPrecision =
        feeAssetId === sellAssetObj.assetId
          ? sellAssetObj.precision
          : feeAssetId === buyAssetObj.assetId
            ? buyAssetObj.precision
            : sellAssetObj.precision
      totalFeeUsd = bnOrZero(feeAmountBaseUnit).div(bnOrZero(10).pow(feeAssetPrecision)).times(feeAssetPrice).toNumber()
    } else {
      totalFeeUsd = (sellAmountUsd * verifiedBps) / 10000
    }

    return { feeUsd: totalFeeUsd * commissionRate, volumeUsd: sellAmountUsd }
  }

  async pollSwapStatus(swapId: string): Promise<SwapStatusResponse> {
    try {
      this.logger.log(`Polling status for swap: ${swapId}`)

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

        this.logger.log(
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
        this.logger.warn(`Failed to verify affiliate for swap ${swapId}:`, verificationError)
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
      this.logger.error(`Failed to poll swap status for ${swapId}:`, error)
      return {
        status: 'PENDING',
        statusMessage: `Error polling status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }

  async findSwapBySwapId(swapId: string) {
    return this.prisma.swap.findUnique({
      where: { swapId },
    })
  }
}
