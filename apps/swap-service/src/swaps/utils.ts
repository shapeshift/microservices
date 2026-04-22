import type { Swap as PrismaSwap } from '@prisma/client'

import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { SwapperSpecificMetadata } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

import { getSwapperFeeStrategy } from '../utils/affiliateFeeAsset'
import type { Swap } from './types'

export const toSwap = (swap: PrismaSwap): Swap => ({
  ...swap,
  sellAsset: swap.sellAsset as Asset,
  buyAsset: swap.buyAsset as Asset,
  metadata: swap.metadata as SwapperSpecificMetadata,
})

export const formatAmount = (amount: string | number): string => {
  // up to 8 decimals, no trailing zeros
  return bnOrZero(amount).toFixed(8).replace(/\.?0+$/, '')
}

export const getAffiliateCommissionRate = (
  origin: string | null,
  verifiedBps: number,
  shapeshiftBps: number,
): number => {
  if (origin === 'web') {
    // Referrer earns shapeshiftBps of volume (shapeshiftBps / verifiedBps of the fee).
    return shapeshiftBps / verifiedBps
  }
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
  if (swap.affiliateFeeAssetId === buyAssetObj.assetId) {
    return swap.buyAssetUsd
  }
  return swap.affiliateAssetUsd
}
