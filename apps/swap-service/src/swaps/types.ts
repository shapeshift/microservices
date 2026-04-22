import type { Swap as PrismaSwap } from '@prisma/client'

import type { SwapperSpecificMetadata } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

export type Swap = Omit<PrismaSwap, 'sellAsset' | 'buyAsset' | 'metadata'> & {
  sellAsset: Asset
  buyAsset: Asset
  metadata: SwapperSpecificMetadata
}

export const toSwap = (swap: PrismaSwap): Swap => ({
  ...swap,
  sellAsset: swap.sellAsset as Asset,
  buyAsset: swap.buyAsset as Asset,
  metadata: swap.metadata as SwapperSpecificMetadata,
})

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
