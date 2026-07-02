import type { Swap as PrismaSwap } from '@prisma/client'
import BigNumber from 'bignumber.js'
import { getAddress } from 'viem'

import type { FeeDeps, FeeResult, PartnerAccrual } from './types'
import {
  aggregateByPartner,
  buildPayouts,
  buildRecord,
  checkFeeAnomaly,
  formatUsdc,
  normalizeAddress,
  resolveWindow,
  toCsv,
} from './utils'

type RowExtras = { swapId?: string; priceable?: boolean; fee?: Partial<FeeResult> }

const makeRow = (overrides: Partial<PrismaSwap> & RowExtras = {}): PrismaSwap =>
  ({
    swapId: 's1',
    partnerCode: 'acme',
    partnerBps: 30,
    verificationStatus: 'SUCCESS',
    isAffiliateVerified: true,
    priceable: true,
    ...overrides,
  }) as unknown as PrismaSwap

// Stub fee math: $12 fee on $2000 volume at 60 verified bps; on-chain actual matches implied by
// default so the guard passes. Per-row overrides via `fee` let tests exercise the deviation guard.
const stubDeps: FeeDeps<PrismaSwap> = {
  toSwap: (row) => row,
  calculateFeeForSwap: (swap) => {
    const r = swap as unknown as RowExtras
    if (r.priceable === false) return null
    return { feeUsd: 12, volumeUsd: 2000, verifiedBps: 60, actualFeeUsd: 12, impliedFeeUsd: 12, ...r.fee }
  },
  getPartnerFeeUsd: (feeUsd, verifiedBps, partnerBps) =>
    verifiedBps <= 0 ? '0' : BigNumber.min(new BigNumber(feeUsd).times(partnerBps).div(verifiedBps), feeUsd).toString(),
}

const accrual = (over: Partial<PartnerAccrual> & Pick<PartnerAccrual, 'partnerCode'>): PartnerAccrual => ({
  swapCount: 1,
  volumeUsd: new BigNumber(2000),
  feesEarnedUsd: new BigNumber(6),
  ...over,
})

describe('resolveWindow', () => {
  it('defaults to the previous calendar month in UTC, end-exclusive', () => {
    const { start, end, label } = resolveWindow(undefined, new Date('2026-07-15T12:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(label).toBe('2026-06')
  })

  it('wraps to December of the prior year in January', () => {
    const { start, end, label } = resolveWindow(undefined, new Date('2026-01-10T00:00:00Z'))
    expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(label).toBe('2025-12')
  })

  it('honors an explicit YYYY-MM month, spanning to the first of the next month', () => {
    const { start, end, label } = resolveWindow('2026-12')
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(label).toBe('2026-12')
  })

  it('rejects malformed or out-of-range month strings', () => {
    expect(() => resolveWindow('2026-13')).toThrow()
    expect(() => resolveWindow('2026-00')).toThrow()
    expect(() => resolveWindow('2026-6')).toThrow()
    expect(() => resolveWindow('2026')).toThrow()
    expect(() => resolveWindow('not-a-month')).toThrow()
  })
})

describe('aggregateByPartner', () => {
  it('sums a partner share across swaps', () => {
    const { partners, unpriceableSwaps, anomalies } = aggregateByPartner([makeRow(), makeRow()], stubDeps)
    const acme = partners.get('acme')
    expect(unpriceableSwaps).toBe(0)
    expect(anomalies).toHaveLength(0)
    expect(acme?.swapCount).toBe(2)
    expect(acme?.volumeUsd.toNumber()).toBeCloseTo(4000)
    // $12 fee * (30/60) = $6 per swap → $12 total
    expect(acme?.feesEarnedUsd.toNumber()).toBeCloseTo(12)
  })

  it('groups case-insensitively across partner-code casings (citext)', () => {
    const { partners } = aggregateByPartner(
      [makeRow({ swapId: 'a', partnerCode: 'Acme' }), makeRow({ swapId: 'b', partnerCode: 'acme' })],
      stubDeps,
    )
    expect(partners.size).toBe(1)
    expect(partners.get('acme')?.swapCount).toBe(2)
  })

  it('caps the partner share at 100% when partnerBps exceeds verifiedBps', () => {
    const { partners } = aggregateByPartner([makeRow({ partnerBps: 120 })], stubDeps)
    expect(partners.get('acme')?.feesEarnedUsd.toNumber()).toBeCloseTo(12)
  })

  it('skips swaps that cannot be priced', () => {
    const { partners, unpriceableSwaps } = aggregateByPartner([makeRow({ priceable: false })], stubDeps)
    expect(unpriceableSwaps).toBe(1)
    expect(partners.size).toBe(0)
  })

  it('partitions unpaid swaps by verificationStatus: pending vs failed for inspection', () => {
    const { partners, unverified } = aggregateByPartner(
      [
        makeRow({ swapId: 'pending', verificationStatus: 'PENDING', isAffiliateVerified: null as unknown as boolean }),
        makeRow({ swapId: 'failed', verificationStatus: 'FAILED', isAffiliateVerified: false }),
      ],
      stubDeps,
    )
    expect(partners.size).toBe(0)
    expect(unverified).toEqual([
      { swapId: 'pending', partnerCode: 'acme', status: 'pending' },
      { swapId: 'failed', partnerCode: 'acme', status: 'failed' },
    ])
  })

  it('does not pay a verified swap with no affiliate fee for us (hasAffiliate=false: not ours or 0 bps)', () => {
    const { partners, noAffiliateFee, unverified } = aggregateByPartner(
      [makeRow({ swapId: 'nofee', verificationStatus: 'SUCCESS', isAffiliateVerified: false })],
      stubDeps,
    )
    expect(partners.size).toBe(0)
    expect(unverified).toHaveLength(0)
    expect(noAffiliateFee).toEqual([{ swapId: 'nofee', partnerCode: 'acme' }])
  })

  it('never pays the bps-implied fee: a swap with no verified on-chain fee is surfaced, not paid', () => {
    const { partners, unresolvedFee } = aggregateByPartner(
      [makeRow({ swapId: 'unresolved', fee: { actualFeeUsd: null, impliedFeeUsd: 12 } })],
      stubDeps,
    )
    expect(partners.size).toBe(0)
    expect(unresolvedFee).toEqual([{ swapId: 'unresolved', partnerCode: 'acme' }])
  })

  it('surfaces a swap with partnerBps unset (0) instead of silently dropping it', () => {
    const { partners, partnerBpsUnset } = aggregateByPartner([makeRow({ swapId: 'z', partnerBps: 0 })], stubDeps)
    expect(partners.size).toBe(0)
    expect(partnerBpsUnset).toEqual([{ swapId: 'z', partnerCode: 'acme', verifiedBps: 60, partnerBps: 0 }])
  })

  it('excludes a swap whose on-chain fee deviates beyond tolerance, recording an anomaly', () => {
    // The woody/maya case: on-chain fee $9000 vs implied $12 → ~750x over → excluded.
    const { partners, anomalies } = aggregateByPartner(
      [makeRow({ swapId: 'bad', fee: { actualFeeUsd: 9000, impliedFeeUsd: 12 } })],
      stubDeps,
    )
    expect(partners.size).toBe(0)
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].swapId).toBe('bad')
  })

  it('still pays a partner for their non-anomalous swaps', () => {
    const { partners, anomalies } = aggregateByPartner(
      [makeRow({ swapId: 'ok' }), makeRow({ swapId: 'bad', fee: { actualFeeUsd: 9000, impliedFeeUsd: 12 } })],
      stubDeps,
    )
    expect(anomalies).toHaveLength(1)
    expect(partners.get('acme')?.swapCount).toBe(1)
    expect(partners.get('acme')?.feesEarnedUsd.toNumber()).toBeCloseTo(6)
  })
})

describe('checkFeeAnomaly', () => {
  const row = { swapId: 's1', partnerCode: 'acme' }
  const fee = (over: Partial<FeeResult>): FeeResult => ({
    feeUsd: 12,
    volumeUsd: 2000,
    verifiedBps: 60,
    actualFeeUsd: 12,
    impliedFeeUsd: 12,
    ...over,
  })

  it('returns null when there is no on-chain fee to check (handled as no-verified-fee upstream)', () => {
    expect(checkFeeAnomaly(row, fee({ actualFeeUsd: null }), 0.25)).toBeNull()
  })

  it('passes when on-chain fee is within tolerance of implied', () => {
    expect(checkFeeAnomaly(row, fee({ actualFeeUsd: 13, impliedFeeUsd: 12 }), 0.25)).toBeNull()
  })

  it('flags when on-chain fee exceeds the deviation band', () => {
    const anomaly = checkFeeAnomaly(row, fee({ actualFeeUsd: 39020, impliedFeeUsd: 0.4 }), 0.25)
    expect(anomaly?.deviation).toBeGreaterThan(0.25)
    expect(anomaly?.reason).toMatch(/deviates/)
  })

  it('flags when the implied fee is unavailable for validation', () => {
    const anomaly = checkFeeAnomaly(row, fee({ actualFeeUsd: 5, impliedFeeUsd: null }), 0.25)
    expect(anomaly?.deviation).toBeNull()
    expect(anomaly?.reason).toMatch(/cannot validate/)
  })
})

describe('formatUsdc', () => {
  it('floors to 6 dp and strips trailing zeros', () => {
    expect(formatUsdc(12)).toBe('12')
    expect(formatUsdc(1000.5)).toBe('1000.5')
    expect(formatUsdc(12.3456789)).toBe('12.345678')
    expect(formatUsdc(0.0000005)).toBe('0')
  })

  it('accepts a BigNumber accrual without float drift', () => {
    expect(formatUsdc(new BigNumber('0.1').plus('0.2'))).toBe('0.3')
  })
})

describe('normalizeAddress', () => {
  it('checksums valid EVM addresses and rejects everything else', () => {
    const lower = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
    expect(normalizeAddress(lower)).toBe(getAddress(lower))
    expect(normalizeAddress(null)).toBeNull()
    expect(normalizeAddress('not-an-address')).toBeNull()
    expect(normalizeAddress('cosmos1abc')).toBeNull()
  })

  it('rejects the zero address', () => {
    expect(normalizeAddress('0x0000000000000000000000000000000000000000')).toBeNull()
  })
})

describe('toCsv', () => {
  it('emits the Safe airdrop header and indexed erc20 rows', () => {
    const csv = toCsv([
      { receiveAddress: '0xabc', usdcAmount: '10' },
      { receiveAddress: '0xdef', usdcAmount: '5.5' },
    ])
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('token_type,token_address,receiver,amount,id')
    expect(lines[1]).toBe('erc20,0xaf88d065e77c8cC2239327C5EDb3A432268e5831,0xabc,10,0')
    expect(lines[2]).toBe('erc20,0xaf88d065e77c8cC2239327C5EDb3A432268e5831,0xdef,5.5,1')
  })
})

describe('buildPayouts', () => {
  it('excludes partners with non-EVM addresses and sorts by earnings', () => {
    const partners = new Map([
      ['acme', accrual({ partnerCode: 'acme', feesEarnedUsd: new BigNumber(6) })],
      [
        'big',
        accrual({ partnerCode: 'big', swapCount: 5, volumeUsd: new BigNumber(9000), feesEarnedUsd: new BigNumber(50) }),
      ],
      ['bad', accrual({ partnerCode: 'bad', volumeUsd: new BigNumber(100), feesEarnedUsd: new BigNumber(1) })],
    ])
    const affiliates = new Map([
      ['acme', { receiveAddress: null, walletAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' }],
      ['big', { receiveAddress: '0x52908400098527886e0f7030069857d2e4169ee7', walletAddress: '0xabc' }],
      ['bad', { receiveAddress: 'cosmos1xyz', walletAddress: 'cosmos1xyz' }],
    ])

    const payouts = buildPayouts(partners, affiliates)

    expect(payouts.map((p) => p.partnerCode)).toEqual(['big', 'acme', 'bad'])
    expect(payouts.find((p) => p.partnerCode === 'acme')?.receiveAddress).toBe(
      getAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045'),
    )
    expect(payouts.find((p) => p.partnerCode === 'bad')?.included).toBe(false)
    expect(payouts.find((p) => p.partnerCode === 'bad')?.excludedReason).toMatch(/invalid payout address/)
  })
})

describe('buildRecord', () => {
  const window = { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-07-01T00:00:00Z'), label: '2026-06' }

  it('maps every excluded bucket to its total and warns per-swap for all but noAffiliateFee', () => {
    const payouts = buildPayouts(
      new Map([
        ['paid', accrual({ partnerCode: 'paid', swapCount: 3, feesEarnedUsd: new BigNumber(30) })],
        ['bad', accrual({ partnerCode: 'bad', feesEarnedUsd: new BigNumber(5) })],
      ]),
      new Map([
        ['paid', { receiveAddress: '0x52908400098527886e0f7030069857d2e4169ee7', walletAddress: '0xabc' }],
        ['bad', { receiveAddress: 'cosmos1xyz', walletAddress: 'cosmos1xyz' }],
      ]),
    )

    const record = buildRecord({
      window,
      payouts,
      generatedAt: '2026-07-01T00:00:00.000Z',
      unpriceableSwaps: 2,
      anomalies: [
        {
          swapId: 'a1',
          partnerCode: 'acme',
          actualFeeUsd: 9000,
          impliedFeeUsd: 12,
          volumeUsd: 2000,
          deviation: 749,
          reason: 'deviates',
        },
      ],
      unverified: [{ swapId: 'u1', partnerCode: 'acme', status: 'pending' }],
      noAffiliateFee: [
        { swapId: 'n1', partnerCode: 'acme' },
        { swapId: 'n2', partnerCode: 'acme' },
      ],
      partnerBpsUnset: [{ swapId: 'p1', partnerCode: 'acme', verifiedBps: 60, partnerBps: 0 }],
      unresolvedFee: [{ swapId: 'r1', partnerCode: 'acme' }],
    })

    expect(record.totals).toEqual({
      partnersPaid: 1,
      totalUsdc: '30.000000',
      paidSwaps: 3,
      unpriceableSwaps: 2,
      feeAnomalySwaps: 1,
      unverifiedSwaps: 1,
      noAffiliateFeeSwaps: 2,
      partnerBpsUnsetSwaps: 1,
      noVerifiedFeeSwaps: 1,
    })

    // Every surfaced bucket is warned per-swap except noAffiliateFee, which is counted-only.
    expect(record.warnings.map((w) => w.type).sort()).toEqual([
      'address',
      'fee-anomaly',
      'no-verified-fee',
      'partner-bps-unset',
      'unverified',
    ])
    const warnedSwapIds = record.warnings.map((w) => w.swapId)
    expect(warnedSwapIds).not.toContain('n1')
    expect(warnedSwapIds).not.toContain('n2')
  })
})
