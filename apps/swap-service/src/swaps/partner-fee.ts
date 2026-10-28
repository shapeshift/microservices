export const FEE_DEVIATION_TOLERANCE = 0.25

export type FeeResult = {
  feeUsd: number
  volumeUsd: number
  verifiedBps: number
  actualFeeUsd: number | null
  impliedFeeUsd: number | null
}

export type PartnerFeeExclusion =
  | 'unattributed'
  | 'unverified'
  | 'no-affiliate-fee'
  | 'unpriceable'
  | 'unresolved-fee'
  | 'fee-anomaly'
  | 'partner-bps-unset'

export type PartnerFeeOutcome =
  | { kind: 'payable'; fee: FeeResult & { actualFeeUsd: number } }
  | { kind: 'excluded'; exclusion: PartnerFeeExclusion; fee: FeeResult | null; deviation: number | null }

type PartnerFeeSwap = {
  attributionStatus: string
  verificationStatus: string
  isAffiliateVerified: boolean | null
  partnerBps: number
}

// how far the on-chain fee is from the bps-implied one, null when there is nothing valid to check it against
export const feeDeviation = (fee: FeeResult): number | null => {
  if (fee.actualFeeUsd === null || fee.impliedFeeUsd === null || fee.impliedFeeUsd <= 0) return null

  const deviation = Math.abs(fee.actualFeeUsd - fee.impliedFeeUsd) / fee.impliedFeeUsd

  return Number.isFinite(deviation) ? deviation : null
}

// the payout's rules in its order, shared so no report counts a fee that would not actually be paid
export const resolvePartnerFee = (
  swap: PartnerFeeSwap,
  calculateFee: () => FeeResult | null,
  tolerance = FEE_DEVIATION_TOLERANCE,
): PartnerFeeOutcome => {
  const excluded = (
    exclusion: PartnerFeeExclusion,
    fee: FeeResult | null = null,
    deviation: number | null = null,
  ): PartnerFeeOutcome => ({ kind: 'excluded', exclusion, fee, deviation })

  if (swap.attributionStatus !== 'ACCEPTED') return excluded('unattributed')
  if (swap.verificationStatus !== 'SUCCESS') return excluded('unverified')
  if (!swap.isAffiliateVerified) return excluded('no-affiliate-fee')

  const fee = calculateFee()
  if (!fee) return excluded('unpriceable')
  if (fee.actualFeeUsd === null) return excluded('unresolved-fee', fee)

  const deviation = feeDeviation(fee)
  if (deviation === null || deviation > tolerance) return excluded('fee-anomaly', fee, deviation)

  if (swap.partnerBps <= 0) return excluded('partner-bps-unset', fee)

  return { kind: 'payable', fee: { ...fee, actualFeeUsd: fee.actualFeeUsd } }
}
