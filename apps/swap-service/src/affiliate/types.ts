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
  sellAmountCryptoPrecision: string
  expectedBuyAmountCryptoPrecision: string
  actualBuyAmountCryptoPrecision: string | null
  sellAmountUsd: string | null
  affiliateBps: string | null
  affiliateFeeUsd: string | null
  swapperName: string
  sellTxHash: string | null
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
