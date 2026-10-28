import BigNumber from 'bignumber.js'
import { getAddress, isAddress, zeroAddress } from 'viem'

import { ABANDONED_STATUS_PREFIX, SETTLED_STATUSES } from '../../apps/swap-service/src/swaps/constants'
import { FEE_DEVIATION_TOLERANCE, feeDeviation, resolvePartnerFee } from '../../apps/swap-service/src/swaps/partner-fee'
import type { Swap as PrismaSwap } from '../../packages/prisma'

import type {
  AggregateResult,
  DeadlineResolvedSwap,
  FeeAnomaly,
  FeeDeps,
  FeeResult,
  NoAffiliateFeeSwap,
  PartnerAccrual,
  PartnerBpsUnsetSwap,
  PartnerPayout,
  PayoutRecord,
  PayoutWarning,
  PayoutWindow,
  UnattributedSwap,
  UnpriceableSwap,
  UnresolvedFeeSwap,
  UnsettledSwap,
  UnverifiedSwap,
} from './types'

export const ARBITRUM_USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
export { FEE_DEVIATION_TOLERANCE }
export const USDC_DECIMALS = 6

function monthLabel(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

type ResolutionDetails = { reason?: string; checked?: boolean; resolvedBy?: 'deadline' } | null

const readDetails = (details: unknown): ResolutionDetails => {
  if (!details || typeof details !== 'object') return null

  const { reason, checked, resolvedBy } = details as Record<string, unknown>

  return {
    reason: typeof reason === 'string' ? reason : undefined,
    checked: checked === true,
    resolvedBy: resolvedBy === 'deadline' ? 'deadline' : undefined,
  }
}

export function resolveWindow(date?: string, now: Date = new Date()): PayoutWindow {
  const { year, monthIndex } = ((): { year: number; monthIndex: number } => {
    if (!date) return { year: now.getUTCFullYear(), monthIndex: now.getUTCMonth() - 1 }

    const match = /^(\d{4})-(\d{2})$/.exec(date)
    if (!match) throw new Error(`Invalid month (expected YYYY-MM): ${date}`)

    const monthIndex = Number(match[2]) - 1
    if (monthIndex < 0 || monthIndex > 11) throw new Error(`Invalid month (expected YYYY-MM): ${date}`)

    return { year: Number(match[1]), monthIndex }
  })()

  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 1))

  return { start, end, label: monthLabel(start) }
}

// Flags the on-chain fee when it deviates too far from — or can't be checked against — the
// bps-implied fee; null when trustworthy. The implied fee only guards, it's never a payout basis.
export function checkFeeAnomaly(
  row: { swapId: string; partnerCode: string },
  fee: FeeResult,
  tolerance: number,
): FeeAnomaly | null {
  if (fee.actualFeeUsd === null) return null

  const base = {
    swapId: row.swapId,
    partnerCode: row.partnerCode,
    actualFeeUsd: fee.actualFeeUsd,
    impliedFeeUsd: fee.impliedFeeUsd,
    volumeUsd: fee.volumeUsd,
  }

  const deviation = feeDeviation(fee)
  if (deviation === null || fee.impliedFeeUsd === null) {
    return { ...base, deviation: null, reason: 'cannot validate on-chain fee: no bps-implied fee available' }
  }

  if (deviation > tolerance) {
    return {
      ...base,
      deviation,
      reason: `on-chain fee $${fee.actualFeeUsd.toFixed(6)} deviates ${(deviation * 100).toFixed(0)}% from bps-implied $${fee.impliedFeeUsd.toFixed(6)} (tolerance ${(tolerance * 100).toFixed(0)}%)`,
    }
  }

  return null
}

// Accrue each partner's fee share from the verified on-chain fee, using the injected swap-service
// fee math. Rows are the window query — swap status SUCCESS with a partner code, in any
// verification state — and each falls into exactly one bucket, tested top to bottom:
//   attributionStatus not ACCEPTED → unattributed          (this transaction is not theirs to be paid for)
//   verificationStatus PENDING     → unverified 'pending'  (not verified yet; may still settle)
//   verificationStatus FAILED      → unverified 'failed'   (verification failed; investigate)
//   verified, no affiliate fee     → noAffiliateFee        (not ours, or ours @ 0 bps)
//   fee math returns null          → unpriceable           (can't price the swap)
//   on-chain fee is null           → unresolvedFee         (nothing verified to pay on)
//   fails the deviation guard      → anomalies             (on-chain fee looks wrong)
//   partner share rate ≤ 0         → partnerBpsUnset       (no partner share configured)
//   otherwise                      → paid: verified fee × rate, accrued to the partner
// Only the verified on-chain fee is ever paid — never the bps-implied estimate.
export function aggregateByPartner<S>(
  rows: PrismaSwap[],
  deps: FeeDeps<S>,
  tolerance: number = FEE_DEVIATION_TOLERANCE,
): AggregateResult {
  const partners = new Map<string, PartnerAccrual>()
  const anomalies: FeeAnomaly[] = []
  const unverified: UnverifiedSwap[] = []
  const unattributed: UnattributedSwap[] = []
  const noAffiliateFee: NoAffiliateFeeSwap[] = []
  const partnerBpsUnset: PartnerBpsUnsetSwap[] = []
  const unresolvedFee: UnresolvedFeeSwap[] = []

  const unpriceable: UnpriceableSwap[] = []

  for (const row of rows) {
    if (!row.partnerCode) continue

    const partnerCode = row.partnerCode.toLowerCase()

    const outcome = resolvePartnerFee(row, () => deps.calculateFeeForSwap(deps.toSwap(row)), tolerance)

    if (outcome.kind === 'excluded') {
      const ref = { swapId: row.swapId, partnerCode }
      const { fee } = outcome

      switch (outcome.exclusion) {
        case 'unattributed':
          unattributed.push({
            ...ref,
            status: row.attributionStatus,
            reason: readDetails(row.attributionDetails)?.reason ?? null,
          })
          break
        case 'unverified':
          unverified.push({ ...ref, status: row.verificationStatus === 'FAILED' ? 'failed' : 'pending' })
          break
        case 'no-affiliate-fee':
          noAffiliateFee.push(ref)
          break
        case 'unpriceable':
          unpriceable.push(ref)
          break
        case 'unresolved-fee':
          unresolvedFee.push(ref)
          break
        case 'fee-anomaly':
          if (fee) {
            const anomaly = checkFeeAnomaly(ref, fee, tolerance)
            if (anomaly) anomalies.push(anomaly)
          }
          break
        case 'partner-bps-unset':
          partnerBpsUnset.push({ ...ref, verifiedBps: fee?.verifiedBps ?? 0, partnerBps: row.partnerBps })
          break
      }
      continue
    }

    const { fee } = outcome

    const accrual = partners.get(partnerCode) ?? {
      partnerCode,
      swapCount: 0,
      volumeUsd: new BigNumber(0),
      feesEarnedUsd: new BigNumber(0),
    }

    // Pay only on the verified on-chain fee, via the shared exact partner-share helper.
    accrual.swapCount += 1
    accrual.volumeUsd = accrual.volumeUsd.plus(fee.volumeUsd)
    accrual.feesEarnedUsd = accrual.feesEarnedUsd.plus(
      deps.getPartnerFeeUsd(fee.actualFeeUsd, fee.verifiedBps, row.partnerBps),
    )

    partners.set(partnerCode.toLowerCase(), accrual)
  }

  return {
    partners,
    unpriceable,
    anomalies,
    unverified,
    unattributed,
    noAffiliateFee,
    partnerBpsUnset,
    unresolvedFee,
  }
}

// Partner swaps a deadline closed out rather than evidence, once per stage, none paid until a person confirms
export function findDeadlineResolved(rows: PrismaSwap[]): DeadlineResolvedSwap[] {
  return rows.flatMap((row) => {
    if (!row.partnerCode) return []

    const base = {
      swapId: row.swapId,
      partnerCode: row.partnerCode.toLowerCase(),
      swapperName: row.swapperName,
      chainId: (row.sellAsset as { chainId?: string } | null)?.chainId ?? null,
      sellTxHash: row.sellTxHash,
    }

    const resolved: DeadlineResolvedSwap[] = []

    const attribution = readDetails(row.attributionDetails)
    const verification = readDetails(row.affiliateVerificationDetails)

    // a transaction the chain itself ruled out can never be paid; a missing hash may be an undetected deposit
    const abandoned = row.status === 'FAILED' && row.statusMessage?.startsWith(ABANDONED_STATUS_PREFIX)
    const disowned = row.attributionStatus === 'REJECTED' && attribution?.checked === true
    if (abandoned && !disowned) {
      resolved.push({ ...base, stage: 'status', reason: row.statusMessage ?? '' })
    }

    if (row.verificationStatus === 'FAILED' && verification?.resolvedBy === 'deadline') {
      resolved.push({ ...base, stage: 'verification', reason: verification.reason ?? '' })
    }

    if (row.attributionStatus === 'REJECTED' && attribution?.resolvedBy === 'deadline') {
      resolved.push({ ...base, stage: 'attribution', reason: attribution.reason ?? '' })
    }

    return resolved
  })
}

// Partner swaps with a stage still pending
export function findUnsettled(rows: PrismaSwap[]): UnsettledSwap[] {
  return rows.flatMap((row) => {
    if (!row.partnerCode) return []

    const stages: UnsettledSwap['stages'] = []
    if (!SETTLED_STATUSES.includes(row.status)) stages.push('status')
    if (row.verificationStatus === 'PENDING') stages.push('verification')
    if (row.attributionStatus === 'PENDING') stages.push('attribution')

    return stages.length ? [{ swapId: row.swapId, partnerCode: row.partnerCode.toLowerCase(), stages }] : []
  })
}

// USD is paid 1:1 as USDC, floored to 6 dp (USDC precision), trailing zeros stripped.
export function formatUsdc(usd: BigNumber.Value): string {
  return new BigNumber(usd).toFixed(USDC_DECIMALS, BigNumber.ROUND_DOWN).replace(/\.?0+$/, '')
}

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null
  if (!isAddress(address)) return null
  const checksummed = getAddress(address)
  if (checksummed === zeroAddress) return null
  return checksummed
}

export function toCsv(rows: { receiveAddress: string; usdcAmount: string }[]): string {
  const header = 'token_type,token_address,receiver,amount,id'
  const lines = rows.map(
    (row, index) => `erc20,${ARBITRUM_USDC_ADDRESS},${row.receiveAddress},${row.usdcAmount},${index}`,
  )
  return [header, ...lines].join('\n') + '\n'
}

export function buildPayouts(
  partners: Map<string, PartnerAccrual>,
  affiliatesByCode: Map<string, { receiveAddress: string | null; walletAddress: string }>,
): PartnerPayout[] {
  const payouts: PartnerPayout[] = []

  for (const accrual of partners.values()) {
    if (accrual.feesEarnedUsd.lte(0)) continue

    const affiliate = affiliatesByCode.get(accrual.partnerCode)
    const receiveAddress = affiliate?.receiveAddress ?? affiliate?.walletAddress
    const normalizedReceiveAddress = normalizeAddress(receiveAddress)

    const excludedReason = (() => {
      if (!affiliate) return 'no affiliate found for partner code'
      if (!normalizedReceiveAddress) return `invalid payout address: ${receiveAddress ?? 'none'}`
      return null
    })()

    payouts.push({
      ...accrual,
      receiveAddress: normalizedReceiveAddress,
      included: excludedReason === null,
      excludedReason,
      usdcAmount: formatUsdc(accrual.feesEarnedUsd),
    })
  }

  return payouts.sort((a, b) => b.feesEarnedUsd.comparedTo(a.feesEarnedUsd) ?? 0)
}

export function buildRecord(input: {
  window: PayoutWindow
  payouts: PartnerPayout[]
  generatedAt: string
  unpriceable: UnpriceableSwap[]
  anomalies: FeeAnomaly[]
  unverified: UnverifiedSwap[]
  unattributed: UnattributedSwap[]
  noAffiliateFee: NoAffiliateFeeSwap[]
  partnerBpsUnset: PartnerBpsUnsetSwap[]
  unresolvedFee: UnresolvedFeeSwap[]
  deadlineResolved: DeadlineResolvedSwap[]
}): PayoutRecord {
  const {
    window,
    payouts,
    generatedAt,
    unpriceable,
    anomalies,
    unverified,
    unattributed,
    noAffiliateFee,
    partnerBpsUnset,
    unresolvedFee,
    deadlineResolved,
  } = input
  const included = payouts.filter((p) => p.included)
  const totalUsdc = included.reduce((sum, p) => sum.plus(p.usdcAmount), new BigNumber(0))

  const warnings: PayoutWarning[] = [
    ...anomalies.map((a) => ({
      type: 'fee-anomaly' as const,
      partnerCode: a.partnerCode,
      swapId: a.swapId,
      reason: a.reason,
    })),
    ...payouts
      .filter((p) => !p.included)
      .map((p) => ({ type: 'address' as const, partnerCode: p.partnerCode, swapId: null, reason: p.excludedReason })),
    ...unattributed.map((u) => ({
      type: 'unattributed' as const,
      partnerCode: u.partnerCode,
      swapId: u.swapId,
      reason: `attribution ${u.status.toLowerCase()}${u.reason ? ` (${u.reason})` : ''} — not paid, this transaction is not attributed to them`,
    })),
    ...unverified.map((u) => ({
      type: 'unverified' as const,
      partnerCode: u.partnerCode,
      swapId: u.swapId,
      reason: `affiliate verification ${u.status} — not paid, inspect before final payout`,
    })),
    ...partnerBpsUnset.map((u) => ({
      type: 'partner-bps-unset' as const,
      partnerCode: u.partnerCode,
      swapId: u.swapId,
      reason: `partnerBps is 0 (verifiedBps ${u.verifiedBps}) — no partner share configured, excluded`,
    })),
    ...unpriceable.map((u) => ({
      type: 'unpriceable' as const,
      partnerCode: u.partnerCode,
      swapId: u.swapId,
      reason:
        'fee could not be valued (a USD price or verified amount is missing) — not paid, fix the row and regenerate',
    })),
    ...unresolvedFee.map((n) => ({
      type: 'no-verified-fee' as const,
      partnerCode: n.partnerCode,
      swapId: n.swapId,
      reason: 'no verified on-chain fee — not paid (bps-implied fee is never a payout basis)',
    })),
  ]

  return {
    window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label },
    generatedAt,
    token: { chain: 'arbitrum', address: ARBITRUM_USDC_ADDRESS, symbol: 'USDC' },
    totals: {
      partnersPaid: included.length,
      totalUsdc: totalUsdc.toFixed(USDC_DECIMALS),
      paidSwaps: included.reduce((sum, p) => sum + p.swapCount, 0),
      unpriceableSwaps: unpriceable.length,
      feeAnomalySwaps: anomalies.length,
      unverifiedSwaps: unverified.length,
      unattributedSwaps: unattributed.length,
      noAffiliateFeeSwaps: noAffiliateFee.length,
      partnerBpsUnsetSwaps: partnerBpsUnset.length,
      noVerifiedFeeSwaps: unresolvedFee.length,
      deadlineResolvedSwaps: deadlineResolved.length,
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
    deadlineResolved,
  }
}
