import type { Swap as PrismaSwap } from '@prisma/client'
import { getAddress } from 'viem'

import {
  aggregateByPartner,
  buildPayouts,
  checkFeeAnomaly,
  type FeeDeps,
  type FeeResult,
  formatUsdc,
  normalizeRecipient,
  resolveWindow,
  toCsv,
} from './affiliate-payouts-lib'

type RowExtras = { swapId?: string; priceable?: boolean; fee?: Partial<FeeResult> }

const makeRow = (overrides: Partial<PrismaSwap> & RowExtras = {}): PrismaSwap =>
  ({ swapId: 's1', partnerCode: 'acme', partnerBps: 30, priceable: true, ...overrides }) as unknown as PrismaSwap

// Stub fee math: $12 fee on $2000 volume at 60 verified bps; on-chain actual matches implied by
// default so the guard passes. Per-row overrides via `fee` let tests exercise the deviation guard.
const stubDeps: FeeDeps<PrismaSwap> = {
  toSwap: (row) => row,
  calculateFeeForSwap: (swap) => {
    const r = swap as unknown as RowExtras
    if (r.priceable === false) return null
    return { feeUsd: 12, volumeUsd: 2000, verifiedBps: 60, actualFeeUsd: 12, impliedFeeUsd: 12, ...r.fee }
  },
  getPartnerFeeRate: (verifiedBps, partnerBps) => Math.min(partnerBps / verifiedBps, 1),
}

describe('resolveWindow', () => {
  it('defaults to the previous calendar month in UTC, end-exclusive', () => {
    const { start, end, label } = resolveWindow(undefined, undefined, new Date('2026-07-15T12:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(label).toBe('2026-06')
  })

  it('wraps to December of the prior year in January', () => {
    const { start, end, label } = resolveWindow(undefined, undefined, new Date('2026-01-10T00:00:00Z'))
    expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(label).toBe('2025-12')
  })

  it('honors explicit ISO date args', () => {
    const { start, end, label } = resolveWindow('2026-03-01', '2026-04-01')
    expect(start.toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(label).toBe('2026-03')
  })

  it('rejects a single date arg, invalid dates, and inverted ranges', () => {
    expect(() => resolveWindow('2026-03-01')).toThrow()
    expect(() => resolveWindow('not-a-date', '2026-04-01')).toThrow()
    expect(() => resolveWindow('2026-04-01', '2026-03-01')).toThrow()
  })
})

describe('aggregateByPartner', () => {
  it('sums a partner share across swaps', () => {
    const { partners, skippedSwaps, anomalies } = aggregateByPartner([makeRow(), makeRow()], stubDeps)
    const acme = partners.get('acme')
    expect(skippedSwaps).toBe(0)
    expect(anomalies).toHaveLength(0)
    expect(acme?.swapCount).toBe(2)
    expect(acme?.volumeUsd).toBeCloseTo(4000)
    // $12 fee * (30/60) = $6 per swap → $12 total
    expect(acme?.feesEarnedUsd).toBeCloseTo(12)
  })

  it('caps the partner share at 100% when partnerBps exceeds verifiedBps', () => {
    const { partners } = aggregateByPartner([makeRow({ partnerBps: 120 })], stubDeps)
    expect(partners.get('acme')?.feesEarnedUsd).toBeCloseTo(12)
  })

  it('skips swaps that cannot be priced', () => {
    const { partners, skippedSwaps } = aggregateByPartner([makeRow({ priceable: false })], stubDeps)
    expect(skippedSwaps).toBe(1)
    expect(partners.size).toBe(0)
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
    expect(partners.get('acme')?.feesEarnedUsd).toBeCloseTo(6)
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

  it('passes when no on-chain fee is present (implied fee used as-is)', () => {
    expect(checkFeeAnomaly(row, fee({ actualFeeUsd: null }), 0.5)).toBeNull()
  })

  it('passes when on-chain fee is within tolerance of implied', () => {
    expect(checkFeeAnomaly(row, fee({ actualFeeUsd: 13, impliedFeeUsd: 12 }), 0.5)).toBeNull()
  })

  it('flags when on-chain fee exceeds the deviation band', () => {
    const anomaly = checkFeeAnomaly(row, fee({ actualFeeUsd: 39020, impliedFeeUsd: 0.4 }), 0.5)
    expect(anomaly?.deviation).toBeGreaterThan(0.5)
    expect(anomaly?.reason).toMatch(/deviates/)
  })

  it('flags when the implied fee is unavailable for validation', () => {
    const anomaly = checkFeeAnomaly(row, fee({ actualFeeUsd: 5, impliedFeeUsd: null }), 0.5)
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
})

describe('normalizeRecipient', () => {
  it('checksums valid EVM addresses and rejects everything else', () => {
    const lower = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
    expect(normalizeRecipient(lower)).toBe(getAddress(lower))
    expect(normalizeRecipient(null)).toBeNull()
    expect(normalizeRecipient('not-an-address')).toBeNull()
    expect(normalizeRecipient('cosmos1abc')).toBeNull()
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
      ['acme', { partnerCode: 'acme', swapCount: 1, volumeUsd: 2000, feesEarnedUsd: 6 }],
      ['big', { partnerCode: 'big', swapCount: 5, volumeUsd: 9000, feesEarnedUsd: 50 }],
      ['bad', { partnerCode: 'bad', swapCount: 1, volumeUsd: 100, feesEarnedUsd: 1 }],
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
    expect(payouts.find((p) => p.partnerCode === 'bad')?.excludedReason).toMatch(/non-EVM/)
  })
})
