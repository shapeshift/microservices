import { Type } from 'class-transformer'
import { IsDate, IsEthereumAddress, IsInt, IsOptional, Matches, Max, Min, MinDate } from 'class-validator'

import type { Affiliate } from '@shapeshift/prisma'

import { PaginationQueryDto } from '../swaps/types'

import { PARTNER_CODE_REGEX } from './utils'

const PARTNER_CODE_MESSAGE = 'Partner code must be 3-32 lowercase letters or numbers (e.g. mypartnercode)'

// Postgres has no year 0, so an earlier date would fail the query instead of the request
const MIN_DATE = new Date(0)

export type AffiliateRole = 'owner' | 'admin'

export interface ResolvedAffiliate {
  affiliate: Affiliate
  role: AffiliateRole
}

export interface AffiliateMemberResponse {
  walletAddress: string
  role: AffiliateRole
  addedBy: string | null
  createdAt: Date
}

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
  @MinDate(MIN_DATE)
  startDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(MIN_DATE)
  endDate?: Date
}

export class AffiliateSwapsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(PARTNER_CODE_REGEX, { message: PARTNER_CODE_MESSAGE })
  partnerCode?: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(MIN_DATE)
  startDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MinDate(MIN_DATE)
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
  receiveAddress?: string | null

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  bps?: number
}

export class AddAffiliateMemberDto {
  @IsEthereumAddress()
  walletAddress: string
}
