export interface AffiliateStatsResult {
  totalSwaps: number
  totalVolumeUsd: string
  totalFeesEarnedUsd: string
}

export interface AffiliateSwapItem {
  swapId: string
  status: string
  sellAsset: unknown
  buyAsset: unknown
  sellAmountCryptoBaseUnit: string
  expectedBuyAmountCryptoBaseUnit: string
  actualBuyAmountCryptoBaseUnit: string | null
  sellAmountUsd: string | null
  buyAssetUsd: string | null
  affiliateBps: number | null
  shapeshiftBps: number
  affiliateFeeUsd: string | null
  swapperName: string
  sellTxHash: string | null
  buyTxHash: string | null
  isAffiliateVerified: boolean | null
  createdAt: Date
}

export interface AffiliateSwapsResult {
  swaps: AffiliateSwapItem[]
  nextCursor: string | null
}

export interface GetAffiliateSwapsOptions {
  startDate?: Date
  endDate?: Date
  limit?: number
  cursor?: string
}

export interface CreateAffiliateDto {
  walletAddress: string
  receiveAddress?: string
  partnerCode?: string
  bps?: number
}

export interface UpdateAffiliateDto {
  receiveAddress?: string
  bps?: number
  isActive?: boolean
}
