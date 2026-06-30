import type { Swap as PrismaSwap } from '@prisma/client'
import BigNumber from 'bignumber.js'
import { getAddress, isAddress } from 'viem'

// USDC on Arbitrum One — payouts are imported into the Safe CSV-airdrop app on arbitrum.
export const ARBITRUM_USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
export const USDC_DECIMALS = 6

// A swap's on-chain affiliate fee should land near the bps-implied fee (volume × verifiedBps),
// but never matches exactly — price drift between quote and execution, partial/streaming fills,
// and fee-asset conversion all introduce slack. Beyond this relative band we treat the on-chain
// amount as untrustworthy (corrupt/misreported), flag it, and exclude the swap from payout.
export const FEE_DEVIATION_TOLERANCE = 0.5

export type PartnerAccrual = {
  partnerCode: string
  swapCount: number
  volumeUsd: number
  feesEarnedUsd: number
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

// Injected so the aggregation can be unit-tested without loading the swap-service module graph.
export type FeeDeps<S> = {
  toSwap: (row: PrismaSwap) => S
  calculateFeeForSwap: (swap: S) => FeeResult | null
  getPartnerFeeRate: (verifiedBps: number, partnerBps: number) => number
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const monthLabel = (d: Date): string => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`

// Default window is the previous calendar month in UTC, end-exclusive (gte start, lt end).
// Explicit ISO args override it. `now` is injectable for testing.
export const resolveWindow = (startArg?: string, endArg?: string, now: Date = new Date()): PayoutWindow => {
  if (startArg || endArg) {
    if (!startArg || !endArg) throw new Error('Provide both startDate and endDate, or neither.')
    const start = new Date(startArg)
    const end = new Date(endArg)
    if (Number.isNaN(start.getTime())) throw new Error(`Invalid startDate: ${startArg}`)
    if (Number.isNaN(end.getTime())) throw new Error(`Invalid endDate: ${endArg}`)
    if (end <= start) throw new Error('endDate must be after startDate.')
    return { start, end, label: monthLabel(start) }
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { start, end, label: monthLabel(start) }
}

// Returns an anomaly when a swap reports an on-chain fee that doesn't align with its
// bps-implied fee (or can't be validated against one). null means the on-chain fee is
// trustworthy — or absent, in which case the bps-implied fee is used as-is.
export const checkFeeAnomaly = (
  row: { swapId: string; partnerCode: string },
  fee: FeeResult,
  tolerance: number,
): FeeAnomaly | null => {
  if (fee.actualFeeUsd === null) return null // no on-chain amount to distrust; implied fee is used

  const base = { swapId: row.swapId, partnerCode: row.partnerCode, actualFeeUsd: fee.actualFeeUsd, volumeUsd: fee.volumeUsd }

  if (fee.impliedFeeUsd === null || fee.impliedFeeUsd <= 0) {
    return { ...base, impliedFeeUsd: fee.impliedFeeUsd, deviation: null, reason: 'cannot validate on-chain fee: no bps-implied fee available' }
  }

  const deviation = Math.abs(fee.actualFeeUsd - fee.impliedFeeUsd) / fee.impliedFeeUsd
  if (deviation > tolerance) {
    return {
      ...base,
      impliedFeeUsd: fee.impliedFeeUsd,
      deviation,
      reason: `on-chain fee $${fee.actualFeeUsd.toFixed(6)} deviates ${(deviation * 100).toFixed(0)}% from bps-implied $${fee.impliedFeeUsd.toFixed(6)} (tolerance ${(tolerance * 100).toFixed(0)}%)`,
    }
  }

  return null
}

// Sum each partner's earned fee share using the injected swap-service fee math. Swaps whose
// on-chain fee fails the deviation guard are excluded and returned as anomalies; unpriceable
// swaps are skipped.
export const aggregateByPartner = <S>(
  rows: PrismaSwap[],
  deps: FeeDeps<S>,
  tolerance: number = FEE_DEVIATION_TOLERANCE,
): { partners: Map<string, PartnerAccrual>; skippedSwaps: number; anomalies: FeeAnomaly[] } => {
  const partners = new Map<string, PartnerAccrual>()
  const anomalies: FeeAnomaly[] = []
  let skippedSwaps = 0

  for (const row of rows) {
    if (!row.partnerCode) continue

    const fee = deps.calculateFeeForSwap(deps.toSwap(row))
    if (!fee) {
      skippedSwaps++
      continue
    }

    const anomaly = checkFeeAnomaly(row, fee, tolerance)
    if (anomaly) {
      anomalies.push(anomaly)
      continue
    }

    const rate = deps.getPartnerFeeRate(fee.verifiedBps, row.partnerBps)

    const accrual = partners.get(row.partnerCode) ?? {
      partnerCode: row.partnerCode,
      swapCount: 0,
      volumeUsd: 0,
      feesEarnedUsd: 0,
    }

    accrual.swapCount += 1
    accrual.volumeUsd += fee.volumeUsd
    accrual.feesEarnedUsd += fee.feeUsd * rate
    partners.set(row.partnerCode, accrual)
  }

  return { partners, skippedSwaps, anomalies }
}

// USD is paid 1:1 as USDC, floored to 6 dp (USDC precision), trailing zeros stripped.
export const formatUsdc = (usd: number): string =>
  new BigNumber(usd)
    .toFixed(USDC_DECIMALS, BigNumber.ROUND_DOWN)
    .replace(/\.?0+$/, '')

// null for missing/non-EVM addresses; otherwise the checksummed address.
export const normalizeRecipient = (address: string | null | undefined): string | null => {
  if (!address) return null
  if (!isAddress(address)) return null
  return getAddress(address)
}

export const toCsv = (rows: { receiveAddress: string; usdcAmount: string }[]): string => {
  const header = 'token_type,token_address,receiver,amount,id'
  const lines = rows.map(
    (row, index) => `erc20,${ARBITRUM_USDC_ADDRESS},${row.receiveAddress},${row.usdcAmount},${index}`,
  )
  return [header, ...lines].join('\n') + '\n'
}

export const buildPayouts = (
  partners: Map<string, PartnerAccrual>,
  affiliatesByCode: Map<string, { receiveAddress: string | null; walletAddress: string }>,
): PartnerPayout[] => {
  const payouts: PartnerPayout[] = []

  for (const accrual of partners.values()) {
    if (accrual.feesEarnedUsd <= 0) continue

    const affiliate = affiliatesByCode.get(accrual.partnerCode)
    const rawAddress = affiliate ? (affiliate.receiveAddress ?? affiliate.walletAddress) : null
    const receiveAddress = normalizeRecipient(rawAddress)

    let excludedReason: string | null = null
    if (!affiliate) excludedReason = 'no affiliate found for partner code'
    else if (!receiveAddress) excludedReason = `invalid (non-EVM) payout address: ${rawAddress ?? 'none'}`

    payouts.push({
      ...accrual,
      receiveAddress,
      included: excludedReason === null,
      excludedReason,
      usdcAmount: formatUsdc(accrual.feesEarnedUsd),
    })
  }

  return payouts.sort((a, b) => b.feesEarnedUsd - a.feesEarnedUsd)
}

export type PayoutWarning = {
  type: 'fee-anomaly' | 'address'
  partnerCode: string
  swapId: string | null
  reason: string | null
}

export type PayoutRecord = {
  window: { start: string; end: string; label: string }
  generatedAt: string
  token: { chain: string; address: string; symbol: string }
  totals: { partnersPaid: number; totalUsdc: string; eligibleSwaps: number; skippedSwaps: number; anomalousSwaps: number }
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

export const buildRecord = (
  window: PayoutWindow,
  payouts: PartnerPayout[],
  skippedSwaps: number,
  anomalies: FeeAnomaly[],
  generatedAt: string,
): PayoutRecord => {
  const included = payouts.filter((p) => p.included)
  const totalUsdc = included.reduce((sum, p) => sum.plus(p.usdcAmount), new BigNumber(0))

  const warnings: PayoutWarning[] = [
    ...anomalies.map((a) => ({ type: 'fee-anomaly' as const, partnerCode: a.partnerCode, swapId: a.swapId, reason: a.reason })),
    ...payouts
      .filter((p) => !p.included)
      .map((p) => ({ type: 'address' as const, partnerCode: p.partnerCode, swapId: null, reason: p.excludedReason })),
  ]

  return {
    window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label },
    generatedAt,
    token: { chain: 'arbitrum', address: ARBITRUM_USDC_ADDRESS, symbol: 'USDC' },
    totals: {
      partnersPaid: included.length,
      totalUsdc: totalUsdc.toFixed(USDC_DECIMALS),
      eligibleSwaps: payouts.reduce((sum, p) => sum + p.swapCount, 0),
      skippedSwaps,
      anomalousSwaps: anomalies.length,
    },
    partners: payouts.map((p) => ({
      partnerCode: p.partnerCode,
      receiveAddress: p.receiveAddress,
      swapCount: p.swapCount,
      volumeUsd: p.volumeUsd.toFixed(2),
      feesEarnedUsd: p.feesEarnedUsd.toFixed(USDC_DECIMALS),
      usdcAmount: p.usdcAmount,
      included: p.included,
      excludedReason: p.excludedReason,
    })),
    warnings,
  }
}
