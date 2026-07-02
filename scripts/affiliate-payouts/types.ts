import type { Swap as PrismaSwap } from '@prisma/client'
import type BigNumber from 'bignumber.js'

export type PartnerAccrual = {
  partnerCode: string
  swapCount: number
  volumeUsd: BigNumber
  feesEarnedUsd: BigNumber
}

export type PartnerPayout = PartnerAccrual & {
  receiveAddress: string | null
  included: boolean
  excludedReason: string | null
  usdcAmount: string
}

export type PayoutWindow = { start: Date; end: Date; label: string }

export type FeeResult = {
  feeUsd: number
  volumeUsd: number
  verifiedBps: number
  actualFeeUsd: number | null
  impliedFeeUsd: number | null
}

export type FeeAnomaly = {
  swapId: string
  partnerCode: string
  actualFeeUsd: number | null
  impliedFeeUsd: number | null
  volumeUsd: number
  deviation: number | null
  reason: string
}

export type UnverifiedSwap = {
  swapId: string
  partnerCode: string
  status: 'pending' | 'failed'
}

// A verified swap with no on chain affiliate fee.
export type NoAffiliateFeeSwap = {
  swapId: string
  partnerCode: string
}

// A verified swap whose partner share is 0 because partnerBps is 0.
export type PartnerBpsUnsetSwap = {
  swapId: string
  partnerCode: string
  verifiedBps: number
  partnerBps: number
}

// A verified swap with no resolvable on-chain fee (e.g. fee asset/price unavailable).
export type UnresolvedFeeSwap = {
  swapId: string
  partnerCode: string
}

export type AggregateResult = {
  partners: Map<string, PartnerAccrual>
  unpriceableSwaps: number
  anomalies: FeeAnomaly[]
  unverified: UnverifiedSwap[]
  noAffiliateFee: NoAffiliateFeeSwap[]
  partnerBpsUnset: PartnerBpsUnsetSwap[]
  unresolvedFee: UnresolvedFeeSwap[]
}

export type FeeDeps<S> = {
  toSwap: (row: PrismaSwap) => S
  calculateFeeForSwap: (swap: S) => FeeResult | null
  getPartnerFeeUsd: (feeUsd: number, verifiedBps: number, partnerBps: number) => string
}

export type PayoutWarning = {
  type: 'fee-anomaly' | 'address' | 'unverified' | 'partner-bps-unset' | 'no-verified-fee'
  partnerCode: string
  swapId: string | null
  reason: string | null
}

export type PayoutRecord = {
  window: { start: string; end: string; label: string }
  generatedAt: string
  token: { chain: string; address: string; symbol: string }
  totals: {
    partnersPaid: number
    totalUsdc: string
    paidSwaps: number
    unpriceableSwaps: number
    feeAnomalySwaps: number
    unverifiedSwaps: number
    noAffiliateFeeSwaps: number
    partnerBpsUnsetSwaps: number
    noVerifiedFeeSwaps: number
  }
  partners: {
    partnerCode: string
    receiveAddress: string | null
    swapCount: number
    volumeUsd: string
    feesEarnedUsd: string
    usdcAmount: string
    included: boolean
    excludedReason: string | null
  }[]
  warnings: PayoutWarning[]
}
