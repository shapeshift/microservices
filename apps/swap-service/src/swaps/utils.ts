import { Logger } from '@nestjs/common'
import axios from 'axios'

import type { Swap as PrismaSwap } from '@shapeshift/prisma'
import type { CreateSwapDto, SwapStatus } from '@shapeshift/shared-types'
import { baseUnitToPrecision } from '@shapeshift/shared-utils'
import { mayachainAssetId, thorchainAssetId } from '@shapeshiftoss/caip'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { Swap as SwapperSwap, SwapMetadata, SwapperName } from '@shapeshiftoss/swapper'
import { swappers } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

import type { BlockTimeLookup } from '../lib/block-time.service'
import { getAssetPriceUsd, getAssetPriceUsdAt } from '../utils/pricing'

import {
  ABANDONED_STATUS_PREFIX,
  DAY_MS,
  DEPOSIT_WINDOW_MS,
  HOUR_MS,
  MINUTE_MS,
  PENDING_TIMEOUT_MS,
  RESOLUTION_DEADLINE_MS,
  SETTLED_STATUSES,
} from './constants'
import type { AffiliateVerificationDetails, AttributionVerdict, StatusNotification, Swap, UsdPrices } from './types'

const logger = new Logger('SwapsService')

const BPS_DENOMINATOR = 10000

// Native precisions of the THORChain/MAYAChain native fee assets — the precision the affiliate fee
// amount is stored in for these chains.
const RUNE_PRECISION = 8
const CACAO_PRECISION = 10

// Historical rows may persist `{}` for affiliateVerificationDetails; coerce anything
// that doesn't satisfy the tightened shape (requires `hasAffiliate`) to null.
const toAffiliateVerificationDetails = (
  raw: PrismaSwap['affiliateVerificationDetails'],
): AffiliateVerificationDetails | null => {
  if (!raw || typeof raw !== 'object') return null
  const details = raw as Partial<AffiliateVerificationDetails>
  if (typeof details.hasAffiliate !== 'boolean') return null
  return details as AffiliateVerificationDetails
}

export const toSwap = (swap: PrismaSwap): Swap => ({
  ...swap,
  swapperName: swap.swapperName as SwapperName,
  sellAsset: swap.sellAsset as Asset,
  buyAsset: swap.buyAsset as Asset,
  metadata: swap.metadata as SwapMetadata,
  affiliateVerificationDetails: toAffiliateVerificationDetails(swap.affiliateVerificationDetails),
})

export const stallTimeoutMs = (isExternallyPaid: boolean): number =>
  (isExternallyPaid ? DEPOSIT_WINDOW_MS : 0) + PENDING_TIMEOUT_MS

export const resolveStalledSwap = (
  status: SwapStatus,
  createdAt: Date,
  statusMessage: string,
  isExternallyPaid: boolean,
): { status: SwapStatus; statusMessage: string } => {
  const timeoutMs = stallTimeoutMs(isExternallyPaid)

  if (status !== 'PENDING') return { status, statusMessage }
  if (Date.now() - createdAt.getTime() < timeoutMs) return { status, statusMessage }

  const last = statusMessage || 'none reported'

  return {
    status: 'FAILED',
    statusMessage: `${ABANDONED_STATUS_PREFIX} unsettled ${timeoutMs / HOUR_MS}h after registration (last swapper status: ${last})`,
  }
}

// [age below which the interval applies, interval]: live while someone is likely watching, then backing off
const POLL_SCHEDULE: [number, number][] = [
  [10 * MINUTE_MS, 5 * 1000],
  [HOUR_MS, 30 * 1000],
  [DAY_MS, 2 * MINUTE_MS],
]
export const POLL_INTERVAL_CEILING_MS = 10 * MINUTE_MS

export const pollIntervalMs = (ageMs: number): number =>
  POLL_SCHEDULE.find(([below]) => ageMs < below)?.[1] ?? POLL_INTERVAL_CEILING_MS

export const isSettledStatus = (status: string): boolean => SETTLED_STATUSES.includes(status)

export const resolutionCutoff = (): Date => new Date(Date.now() - RESOLUTION_DEADLINE_MS)

// a settled stage its outside source still can't answer for is closed out once this passes
export const isPastResolutionDeadline = (swap: { settledAt: Date | null }): boolean =>
  !!swap.settledAt && swap.settledAt < resolutionCutoff()

export const resolveAttributionFromChain = (
  lookup: BlockTimeLookup,
  quotedAt: Date,
  swap: { status: SwapStatus; createdAt: Date },
): AttributionVerdict => {
  if ('unavailable' in lookup) {
    // rejection cannot be walked back, and a node briefly behind also reports not-found, so this waits
    // until the swap is both abandoned and old enough that a real transaction would have been indexed
    const abandoned = swap.status === 'FAILED' && Date.now() - swap.createdAt.getTime() > PENDING_TIMEOUT_MS

    if (lookup.unavailable === 'not-found' && abandoned) {
      return { status: 'REJECTED', details: { checked: true, reason: 'tx-not-found' } }
    }

    return { status: 'PENDING', details: { checked: false, reason: lookup.unavailable } }
  }

  const blockTime = lookup.blockTime * 1000
  const quoted = quotedAt.getTime()
  const checked = { checked: true, blockTime, quotedAt: quoted }

  if (quoted <= blockTime) return { status: 'ACCEPTED', details: { ...checked, reason: 'quote-precedes-tx' } }

  return { status: 'REJECTED', details: { ...checked, reason: 'quote-postdates-tx' } }
}

export const toQuotedAt = (value: string | undefined): Date | null => {
  if (typeof value !== 'string') return null

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const toSwapperSwap = (swap: Swap): SwapperSwap =>
  ({
    ...swap,
    id: swap.swapId,
    createdAt: swap.createdAt.getTime(),
    updatedAt: swap.updatedAt.getTime(),
  }) as unknown as SwapperSwap

const responseDetail = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') return

  const { message, error } = data as { message?: unknown; error?: unknown }
  const detail = message ?? error

  if (detail === undefined || detail === null) return

  return typeof detail === 'string' ? detail : JSON.stringify(detail)
}

export const describeError = (error: unknown): string => {
  if (axios.isAxiosError(error)) return responseDetail(error.response?.data) ?? error.message
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  return 'Unknown error'
}

// formatAmount up to 8 decimals, no trailing zeros
export const formatAmount = (amount: string | number): string => {
  return bnOrZero(amount)
    .toFixed(8)
    .replace(/\.?0+$/, '')
}

// The partner's share of the affiliate fee in USD, as an exact string. Multiplies before dividing
// (feeUsd × partnerBps ÷ verifiedBps) so the result stays precise — computing a partnerBps/verifiedBps
// rate first (e.g. 50/60) would introduce lossy-float artifacts. Capped at the whole fee.
export const getPartnerFeeUsd = (feeUsd: number, verifiedBps: number, partnerBps: number): string => {
  if (verifiedBps <= 0) return '0'
  const share = bnOrZero(feeUsd).times(partnerBps).div(verifiedBps)
  return (share.gt(feeUsd) ? bnOrZero(feeUsd) : share).toString()
}

export const computeSellAmountUsd = (
  sellAmountCryptoBaseUnit: string,
  precision: number,
  sellAssetUsd: string | null,
): number | null => {
  if (!sellAssetUsd) return null
  return bnOrZero(baseUnitToPrecision(sellAmountCryptoBaseUnit, precision)).times(sellAssetUsd).toNumber()
}

export const fetchUsdPrices = async (data: CreateSwapDto, affiliateFeeAssetId: string | null): Promise<UsdPrices> => {
  try {
    const [sellAssetUsd, buyAssetUsd, affiliateAssetUsd] = await Promise.all([
      getAssetPriceUsd(data.sellAsset.assetId),
      getAssetPriceUsd(data.buyAsset.assetId),
      affiliateFeeAssetId ? getAssetPriceUsd(affiliateFeeAssetId) : Promise.resolve<number | null>(null),
    ])

    return {
      sellAssetUsd: sellAssetUsd?.toString() ?? null,
      buyAssetUsd: buyAssetUsd?.toString() ?? null,
      affiliateAssetUsd: affiliateAssetUsd?.toString() ?? null,
    }
  } catch (err) {
    logger.warn(`Failed to fetch USD prices for swap ${data.swapId}:`, err)
    return { sellAssetUsd: null, buyAssetUsd: null, affiliateAssetUsd: null }
  }
}

type PricedSwap = Pick<
  Swap,
  'createdAt' | 'sellAsset' | 'buyAsset' | 'affiliateFeeAssetId' | 'sellAssetUsd' | 'buyAssetUsd' | 'affiliateAssetUsd'
>

// Missing prices at the swap's registration time; one still unavailable is left out
export const resolveMissingPrices = async (
  swap: PricedSwap,
  priceAt: (assetId: string, at: Date) => Promise<number | null> = getAssetPriceUsdAt,
): Promise<Partial<UsdPrices>> => {
  const missing: [keyof UsdPrices, string][] = []

  if (!swap.sellAssetUsd) missing.push(['sellAssetUsd', swap.sellAsset.assetId])
  if (!swap.buyAssetUsd) missing.push(['buyAssetUsd', swap.buyAsset.assetId])
  if (!swap.affiliateAssetUsd && swap.affiliateFeeAssetId) missing.push(['affiliateAssetUsd', swap.affiliateFeeAssetId])

  // the fee asset is usually the sell or buy asset, so each asset is fetched once
  const assetIds = [...new Set(missing.map(([, assetId]) => assetId))]
  const prices = new Map(
    await Promise.all(assetIds.map(async (assetId) => [assetId, await priceAt(assetId, swap.createdAt)] as const)),
  )

  return Object.fromEntries(
    missing.flatMap(([field, assetId]) => {
      const price = prices.get(assetId)
      return price === null || price === undefined ? [] : [[field, price.toString()]]
    }),
  ) as Partial<UsdPrices>
}

export const buildStatusNotification = (swap: Swap): StatusNotification | null => {
  const { sellAsset, buyAsset } = swap

  const sellAmountCryptoPrecision = baseUnitToPrecision(swap.sellAmountCryptoBaseUnit, sellAsset.precision)
  const sellAmount = formatAmount(sellAmountCryptoPrecision)

  switch (swap.status) {
    case 'SUCCESS': {
      const buyAmountCryptoBaseUnit = swap.actualBuyAmountCryptoBaseUnit ?? swap.expectedBuyAmountCryptoBaseUnit
      const buyAmoutCryptoPrecision = baseUnitToPrecision(buyAmountCryptoBaseUnit, buyAsset.precision)
      const buyAmount = formatAmount(buyAmoutCryptoPrecision)

      return {
        title: 'Swap Completed!',
        body: `Your swap of ${sellAmount} ${sellAsset.symbol} for ${buyAmount} ${buyAsset.symbol} is complete.`,
        type: 'SWAP_COMPLETED',
      }
    }
    case 'FAILED':
      return {
        title: 'Swap Failed',
        body: `Your swap of ${sellAmount} ${sellAsset.symbol} for ${buyAsset.symbol} failed.`,
        type: 'SWAP_FAILED',
      }
    default:
      return null
  }
}

const resolveActualFeeUsd = (swap: Swap): number | null => {
  const amount = swap.actualAffiliateFeeAmountCryptoBaseUnit
  if (!amount || !swap.affiliateFeeAssetId) return null

  let priceUsd: string | null
  let precision: number | null

  switch (swap.affiliateFeeAssetId) {
    case swap.sellAsset.assetId:
      priceUsd = swap.sellAssetUsd
      precision = swap.sellAsset.precision
      break
    case swap.buyAsset.assetId:
      priceUsd = swap.buyAssetUsd
      precision = swap.buyAsset.precision
      break
    case thorchainAssetId:
      // Thorchain collects the affiliate fee in RUNE.
      priceUsd = swap.affiliateAssetUsd
      precision = RUNE_PRECISION
      break
    case mayachainAssetId:
      // Mayachain collects the affiliate fee in CACAO.
      priceUsd = swap.affiliateAssetUsd
      precision = CACAO_PRECISION
      break
    default:
      priceUsd = swap.affiliateAssetUsd
      // Fee asset is neither sell nor buy nor a known native fee asset — precision unknown
      precision = null
  }

  if (!priceUsd || precision === null) return null

  return bnOrZero(amount).div(bnOrZero(10).pow(precision)).times(priceUsd).toNumber()
}

export const calculateFeeForSwap = (
  swap: Swap,
): {
  feeUsd: number
  volumeUsd: number
  verifiedBps: number
  actualFeeUsd: number | null
  impliedFeeUsd: number | null
} | null => {
  if (!swap.isAffiliateVerified) return null

  const verifiedBps = swap.affiliateVerificationDetails?.affiliateBps
  if (verifiedBps === undefined) {
    logger.warn(`Verified swap ${swap.swapId} missing affiliate bps in verification details, skipping`)
    return null
  }

  const verifiedSellAmountCryptoBaseUnit = swap.affiliateVerificationDetails?.verifiedSellAmountCryptoBaseUnit
  if (!verifiedSellAmountCryptoBaseUnit) {
    logger.warn(`Verified swap ${swap.swapId} missing sell amount in verification details, skipping`)
    return null
  }

  const sellAmountUsd = computeSellAmountUsd(
    verifiedSellAmountCryptoBaseUnit,
    swap.sellAsset.precision,
    swap.sellAssetUsd,
  )

  const actualFeeUsd = resolveActualFeeUsd(swap)
  const impliedFeeUsd =
    sellAmountUsd === null ? null : bnOrZero(sellAmountUsd).times(verifiedBps).div(BPS_DENOMINATOR).toNumber()

  // Prefer the on-chain collected fee; fall back to the bps-implied fee.
  const feeUsd = actualFeeUsd ?? impliedFeeUsd

  if (feeUsd === null) {
    logger.warn(`Unable to calculate fee for swap ${swap.swapId}, skipping`)
    return null
  }

  const volumeUsd = (() => {
    if (sellAmountUsd !== null) return sellAmountUsd
    if (verifiedBps === 0) {
      logger.warn(`Swap ${swap.swapId} has 0 bps and no sell price; volume unknown`)
      return 0
    }
    return bnOrZero(actualFeeUsd).times(BPS_DENOMINATOR).div(verifiedBps).toNumber()
  })()

  return { feeUsd, volumeUsd, verifiedBps, actualFeeUsd, impliedFeeUsd }
}

export const isExternallyPaid = (swapperName: SwapperName): boolean =>
  swappers[swapperName]?.supportsExternalPayment === true

export const getExternalPaymentSwappers = (): SwapperName[] =>
  (Object.keys(swappers) as SwapperName[]).filter(isExternallyPaid)
