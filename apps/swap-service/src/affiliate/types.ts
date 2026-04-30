import { Type } from 'class-transformer'
import { IsDate, IsEthereumAddress, IsOptional } from 'class-validator'

import { PaginationQueryDto } from '../swaps/types'

export interface AffiliateStatsResult {
  totalSwaps: number
  totalVolumeUsd: string
  totalFeesEarnedUsd: string
}

export class AffiliateSwapsQueryDto extends PaginationQueryDto {
  @IsEthereumAddress()
  address: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date
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
