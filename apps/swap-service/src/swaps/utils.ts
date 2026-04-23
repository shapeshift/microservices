import { Logger } from '@nestjs/common'
import type { Swap as PrismaSwap } from '@prisma/client'

import type { CreateSwapDto } from '@shapeshift/shared-types'
import { baseUnitToPrecision } from '@shapeshift/shared-utils'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { Swap as SwapperSwap, SwapperSpecificMetadata } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

import { getAssetPriceUsd } from '../utils/pricing'

import type { AffiliateVerificationDetails, StatusNotification, Swap, UsdPrices } from './types'

const logger = new Logger('SwapsService')

const BPS_DENOMINATOR = 10000

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
  sellAsset: swap.sellAsset as Asset,
  buyAsset: swap.buyAsset as Asset,
  metadata: swap.metadata as SwapperSpecificMetadata,
  affiliateVerificationDetails: toAffiliateVerificationDetails(swap.affiliateVerificationDetails),
})

export const toSwapperSwap = (swap: Swap): SwapperSwap =>
  ({
    ...swap,
    id: swap.swapId,
    createdAt: swap.createdAt.getTime(),
    updatedAt: swap.updatedAt.getTime(),
  }) as unknown as SwapperSwap

// formatAmount up to 8 decimals, no trailing zeros
export const formatAmount = (amount: string | number): string => {
  return bnOrZero(amount)
    .toFixed(8)
    .replace(/\.?0+$/, '')
}

export const getAffiliateFeeRate = (verifiedBps: number, shapeshiftBps: number): number => {
  // Partner configured at or below the platform floor — partner keeps the whole fee.
  if (verifiedBps <= shapeshiftBps) return 1
  // Platform takes shapeshiftBps; partner gets the remainder.
  return (verifiedBps - shapeshiftBps) / verifiedBps
}

export const fetchUsdPrices = async (data: CreateSwapDto, affiliateFeeAssetId: string | null): Promise<UsdPrices> => {
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
    logger.warn(`Failed to fetch USD prices for swap ${data.swapId}:`, err)
    return { sellAmountUsd: null, buyAssetUsd: null, affiliateAssetUsd: null }
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

  if (swap.affiliateFeeAssetId === swap.sellAsset.assetId) {
    // Back-derive sell asset price from stored USD value.
    if (!swap.sellAmountUsd) return null
    const sellAmount = bnOrZero(swap.sellAmountCryptoBaseUnit).div(bnOrZero(10).pow(swap.sellAsset.precision))
    if (sellAmount.isZero()) return null
    priceUsd = bnOrZero(swap.sellAmountUsd).div(sellAmount).toFixed()
    precision = swap.sellAsset.precision
  } else if (swap.affiliateFeeAssetId === swap.buyAsset.assetId) {
    priceUsd = swap.buyAssetUsd
    precision = swap.buyAsset.precision
  } else {
    priceUsd = swap.affiliateAssetUsd
    // Fee asset is neither sell nor buy — precision unknown
    precision = null
  }

  if (!priceUsd || precision === null) return null

  return bnOrZero(amount).div(bnOrZero(10).pow(precision)).times(priceUsd).toNumber()
}

export const calculateFeeForSwap = (swap: Swap): { feeUsd: number; volumeUsd: number; verifiedBps: number } | null => {
  const verifiedBps = swap.affiliateVerificationDetails?.affiliateBps
  if (!verifiedBps) {
    logger.warn(`Verified swap ${swap.swapId} missing affiliateBps in verification details, skipping`)
    return null
  }

  const sellAmountUsd = swap.sellAmountUsd ? parseFloat(swap.sellAmountUsd) : null
  const actualFeeUsd = resolveActualFeeUsd(swap)

  if (actualFeeUsd === null && sellAmountUsd === null) {
    logger.warn(`Unable to calculate fee for swap ${swap.swapId}, skipping`)
    return null
  }

  const feeUsd = actualFeeUsd ?? bnOrZero(sellAmountUsd).times(verifiedBps).div(BPS_DENOMINATOR).toNumber()
  const volumeUsd = sellAmountUsd ?? bnOrZero(actualFeeUsd).times(BPS_DENOMINATOR).div(verifiedBps).toNumber()

  return { feeUsd, volumeUsd, verifiedBps }
}
