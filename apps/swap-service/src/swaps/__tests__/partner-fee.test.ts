import type { FeeResult } from '../partner-fee'
import { resolvePartnerFee } from '../partner-fee'

const payableSwap = {
  attributionStatus: 'ACCEPTED',
  verificationStatus: 'SUCCESS',
  isAffiliateVerified: true,
  partnerBps: 30,
}

const fee = (over: Partial<FeeResult> = {}): FeeResult => ({
  feeUsd: 12,
  volumeUsd: 3000,
  verifiedBps: 40,
  actualFeeUsd: 12,
  impliedFeeUsd: 12,
  ...over,
})

describe('resolvePartnerFee', () => {
  it('pays a verified, attributed on-chain fee within the deviation guard', () => {
    expect(resolvePartnerFee(payableSwap, () => fee({ actualFeeUsd: 14 }))).toMatchObject({ kind: 'payable' })
  })

  it('applies the payout rules in order, before computing the fee where it can', () => {
    const calculateFee = jest.fn(() => fee())

    expect(
      resolvePartnerFee({ ...payableSwap, attributionStatus: 'REJECTED', verificationStatus: 'FAILED' }, calculateFee),
    ).toMatchObject({ exclusion: 'unattributed' })
    expect(resolvePartnerFee({ ...payableSwap, verificationStatus: 'PENDING' }, calculateFee)).toMatchObject({
      exclusion: 'unverified',
    })
    expect(resolvePartnerFee({ ...payableSwap, isAffiliateVerified: false }, calculateFee)).toMatchObject({
      exclusion: 'no-affiliate-fee',
    })
    expect(calculateFee).not.toHaveBeenCalled()

    expect(resolvePartnerFee(payableSwap, () => null)).toMatchObject({ exclusion: 'unpriceable' })
    expect(resolvePartnerFee(payableSwap, () => fee({ actualFeeUsd: null }))).toMatchObject({
      exclusion: 'unresolved-fee',
    })
    expect(resolvePartnerFee({ ...payableSwap, partnerBps: 0 }, () => fee())).toMatchObject({
      exclusion: 'partner-bps-unset',
    })
  })

  it('holds back a fee too far from the bps-implied fee, with the deviation for the report', () => {
    expect(resolvePartnerFee(payableSwap, () => fee({ actualFeeUsd: 24 }))).toMatchObject({
      exclusion: 'fee-anomaly',
      deviation: 1,
    })
  })

  it('holds back a fee that cannot be checked rather than paying it unchecked', () => {
    expect(resolvePartnerFee(payableSwap, () => fee({ impliedFeeUsd: null }))).toMatchObject({
      exclusion: 'fee-anomaly',
      deviation: null,
    })
    expect(resolvePartnerFee(payableSwap, () => fee({ actualFeeUsd: Number.NaN }))).toMatchObject({
      exclusion: 'fee-anomaly',
      deviation: null,
    })
  })
})
