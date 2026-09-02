import { Logger } from '@nestjs/common'
import type { AttributionStatus, Prisma, Swap as PrismaSwap } from '@prisma/client'
import axios from 'axios'

import type { CreateSwapDto, SwapStatus } from '@shapeshift/shared-types'
import { baseUnitToPrecision } from '@shapeshift/shared-utils'
import { mayachainAssetId, thorchainAssetId } from '@shapeshiftoss/caip'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { Swap as SwapperSwap, SwapMetadata, SwapperName } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

import type { TxLookup } from '../lib/tx-lookup.service'
import { getAssetPriceUsd } from '../utils/pricing'

import type { AffiliateVerificationDetails, StatusNotification, Swap, UsdPrices } from './types'

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

export const resolveStalledSwap = (
  status: SwapStatus,
  createdAt: Date,
  statusMessage: string,
  timeoutMs: number,
): { status: SwapStatus; statusMessage: string } => {
  if (status !== 'PENDING') return { status, statusMessage }
  if (Date.now() - createdAt.getTime() < timeoutMs) return { status, statusMessage }

  const last = statusMessage || 'none reported'
  const hours = timeoutMs / (60 * 60 * 1000)
  const window = hours >= 48 ? `${hours / 24}d` : `${hours}h`

  return {
    status: 'FAILED',
    statusMessage: `Abandoned: unsettled ${window} after registration (last swapper status: ${last})`,
  }
}

// a harvested tx is broadcast before the quote minted to claim it exists, so only a quote that
// predates its own transaction can be the one that authorised it
export const resolveQuoteBinding = (
  lookup: TxLookup,
  quotedAt: Date | null,
  toleranceMs: number,
): { status: AttributionStatus; details: Prisma.InputJsonValue } => {
  if (!quotedAt) return { status: 'PENDING', details: { checked: false, reason: 'no-quoted-at' } }

  switch (lookup.outcome) {
    case 'unsupported':
      return { status: 'PENDING', details: { checked: false, reason: 'unsupported-chain' } }
    case 'not-found':
      return { status: 'PENDING', details: { checked: false, reason: 'tx-not-found' } }
    case 'error':
      return { status: 'PENDING', details: { checked: false, reason: 'lookup-failed' } }
    case 'found': {
      // unchained reports seconds
      const blockTime = lookup.timestamp * 1000
      const quoted = quotedAt.getTime()
      const checked = { checked: true, blockTime, quotedAt: quoted }

      if (quoted <= blockTime + toleranceMs) return { status: 'ACCEPTED', details: { ...checked, reason: 'quote-precedes-tx' } }

      return { status: 'REJECTED', details: { ...checked, reason: 'quote-postdates-tx' } }
    }
  }
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
