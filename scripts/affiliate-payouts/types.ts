import type BigNumber from 'bignumber.js'

import type { FeeResult } from '../../apps/swap-service/src/swaps/partner-fee'
import type { Swap as PrismaSwap } from '../../packages/prisma'

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

export type { FeeResult }

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

// A swap whose claim on its transaction is not settled in this partner's favour.
export type UnattributedSwap = {
  swapId: string
  partnerCode: string
  status: string
  reason: string | null
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

// A verified swap whose fee could not be valued at all (e.g. a USD price or verified amount is missing).
export type UnpriceableSwap = {
  swapId: string
  partnerCode: string
}

// A verified swap with no resolvable on-chain fee (e.g. fee asset/price unavailable).
export type UnresolvedFeeSwap = {
  swapId: string
  partnerCode: string
}

export type ResolutionStage = 'status' | 'verification' | 'attribution'

// A partner swap whose outcome a deadline decided rather than evidence, so a person should confirm it
export type DeadlineResolvedSwap = {
  swapId: string
  partnerCode: string
  stage: ResolutionStage
  reason: string
  swapperName: string
  chainId: string | null
  sellTxHash: string | null
}

// A partner swap with a stage still unresolved, which would leave the month's payout incomplete
export type UnsettledSwap = {
  swapId: string
  partnerCode: string
  stages: ResolutionStage[]
}

export type AggregateResult = {
  partners: Map<string, PartnerAccrual>
  unpriceable: UnpriceableSwap[]
  anomalies: FeeAnomaly[]
  unverified: UnverifiedSwap[]
  unattributed: UnattributedSwap[]
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
  type:
    | 'fee-anomaly'
    | 'address'
    | 'unverified'
    | 'unattributed'
    | 'partner-bps-unset'
    | 'no-verified-fee'
    | 'unpriceable'
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
    unattributedSwaps: number
    noAffiliateFeeSwaps: number
    partnerBpsUnsetSwaps: number
    noVerifiedFeeSwaps: number
    deadlineResolvedSwaps: number
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
  deadlineResolved: DeadlineResolvedSwap[]
}
