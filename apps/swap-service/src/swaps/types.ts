import type { Swap } from '@prisma/client'

import type { Asset } from '@shapeshiftoss/types'

export type SwapWithAssets = Omit<Swap, 'sellAsset' | 'buyAsset'> & {
  sellAsset: Asset
  buyAsset: Asset
}

export type AffiliateVerificationDetails = {
  affiliateBps?: number
  affiliateAddress?: string
  verifiedSellAmountCryptoBaseUnit?: string
  hasAffiliate?: boolean
}

export type UsdPrices = {
  sellAmountUsd: string | null
  buyAssetUsd: string | null
  affiliateAssetUsd: string | null
}

export type PaginationOptions = {
  limit?: number
  cursor?: string
}
