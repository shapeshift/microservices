import { Logger } from '@nestjs/common'
import type { Swap as PrismaSwap } from '@prisma/client'

import type { CreateSwapDto } from '@shapeshift/shared-types'
import { baseUnitToPrecision } from '@shapeshift/shared-utils'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { SwapperSpecificMetadata } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

import { getSwapperFeeStrategy } from '../utils/affiliateFeeAsset'
import { getAssetPriceUsd } from '../utils/pricing'

import type { StatusNotification, Swap, UsdPrices } from './types'

const logger = new Logger('SwapsService')

export const toSwap = (swap: PrismaSwap): Swap => ({
  ...swap,
  sellAsset: swap.sellAsset as Asset,
  buyAsset: swap.buyAsset as Asset,
  metadata: swap.metadata as SwapperSpecificMetadata,
})

// formatAmount up to 8 decimals, no trailing zeros
export const formatAmount = (amount: string | number): string => {
  return bnOrZero(amount)
    .toFixed(8)
    .replace(/\.?0+$/, '')
}

export const getAffiliateCommissionRate = (
  origin: string | null,
  verifiedBps: number,
  shapeshiftBps: number,
): number => {
  // Referrer earns shapeshiftBps of volume (shapeshiftBps / verifiedBps of the fee).
  if (origin === 'web') return shapeshiftBps / verifiedBps
  if (!origin || verifiedBps <= shapeshiftBps) return 0
  return (verifiedBps - shapeshiftBps) / verifiedBps
}

export const estimateAffiliateFeeAmount = (
  affiliateBps: number,
  swapperName: string,
  sellAmountCryptoBaseUnit: string,
  expectedBuyAmountCryptoBaseUnit: string,
): string => {
  const strategy = getSwapperFeeStrategy(swapperName)
  const bpsMultiplier = affiliateBps / 10000

  switch (strategy) {
    case 'sell_asset':
      return bnOrZero(sellAmountCryptoBaseUnit).times(bpsMultiplier).toFixed(0)
    case 'buy_asset':
      return bnOrZero(expectedBuyAmountCryptoBaseUnit).times(bpsMultiplier).toFixed(0)
    case 'fixed_base':
    default:
      return bnOrZero(sellAmountCryptoBaseUnit).times(bpsMultiplier).toFixed(0)
  }
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

export const resolveSwapSellAmountUsd = (swap: { swapId: string; sellAmountUsd: string | null }): number | null => {
  if (!swap.sellAmountUsd) {
    logger.warn(`Missing sellAmountUsd for swap ${swap.swapId}, skipping`)
    return null
  }

  return parseFloat(swap.sellAmountUsd)
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

export const resolveFeeAssetPrice = (swap: {
  sellAsset: unknown
  buyAsset: unknown
  sellAmountCryptoBaseUnit: string
  sellAmountUsd: string | null
  buyAssetUsd: string | null
  affiliateAssetUsd: string | null
  affiliateFeeAssetId: string | null
}): string | null => {
  if (!swap.affiliateFeeAssetId) return null

  const sellAssetObj = swap.sellAsset as Asset
  const buyAssetObj = swap.buyAsset as Asset

  if (swap.affiliateFeeAssetId === sellAssetObj.assetId && swap.sellAmountUsd) {
    // Back-derive sell price from stored USD value.
    const sellAmountPrecision = bnOrZero(swap.sellAmountCryptoBaseUnit).div(bnOrZero(10).pow(sellAssetObj.precision))
    return sellAmountPrecision.isZero() ? null : bnOrZero(swap.sellAmountUsd).div(sellAmountPrecision).toFixed()
  }

  if (swap.affiliateFeeAssetId === buyAssetObj.assetId) return swap.buyAssetUsd

  return swap.affiliateAssetUsd
}
