import { Type } from 'class-transformer'
import { IsBoolean, IsDate, IsEthereumAddress, IsInt, IsOptional, Matches, Max, Min } from 'class-validator'

import { PaginationQueryDto } from '../swaps/types'

import { PARTNER_CODE_REGEX } from './utils'

const PARTNER_CODE_MESSAGE = 'Partner code must be 3-32 lowercase letters or numbers (e.g. mypartnercode)'

export interface AffiliateStatsResult {
  totalSwaps: number
  totalVolumeUsd: string
  totalFeesEarnedUsd: string
}

export class AffiliateStatsQueryDto {
  @Matches(PARTNER_CODE_REGEX, { message: PARTNER_CODE_MESSAGE })
  partnerCode: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date
}

export class AffiliateSwapsQueryDto extends PaginationQueryDto {
  @Matches(PARTNER_CODE_REGEX, { message: PARTNER_CODE_MESSAGE })
  partnerCode: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date
}

export class CreateAffiliateDto {
  @IsEthereumAddress()
  walletAddress: string

  @IsOptional()
  @IsEthereumAddress()
  receiveAddress?: string

  @Matches(PARTNER_CODE_REGEX, { message: PARTNER_CODE_MESSAGE })
  partnerCode: string

  @IsInt()
  @Min(0)
  @Max(1000)
  bps: number
}

export class UpdateAffiliateDto {
  @IsOptional()
  @IsEthereumAddress()
  receiveAddress?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  bps?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
