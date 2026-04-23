import type { Prisma, Swap as PrismaSwap } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

import type { SwapperSpecificMetadata } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

export type Swap = Omit<PrismaSwap, 'sellAsset' | 'buyAsset' | 'metadata' | 'affiliateVerificationDetails'> & {
  sellAsset: Asset
  buyAsset: Asset
  metadata: SwapperSpecificMetadata
  affiliateVerificationDetails: AffiliateVerificationDetails | null
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

export type FeeTotals = {
  periodCount: number
  periodVolumeUsd: number
  periodFeesUsd: number
  allTimeCount: number
  allTimeFeesUsd: number
}

export type AggregateFeesParams = {
  baseWhere: Prisma.SwapWhereInput
  startDate?: Date
  endDate?: Date
  calcFee: (swap: Swap) => { feeUsd: number; volumeUsd: number } | null
}

export type PaginatedSwaps = {
  items: Swap[]
  nextCursor: string | null
}

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50

  @IsOptional()
  @IsString()
  cursor?: string
}

export type StatusNotification = {
  title: string
  body: string
  type: 'SWAP_COMPLETED' | 'SWAP_FAILED'
}
