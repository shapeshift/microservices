import * as fs from 'fs'
import * as path from 'path'

import { calculateFeeForSwap, getPartnerFeeUsd, toSwap } from '../../apps/swap-service/src/swaps/utils'
import { createPrismaAdapter, PrismaClient } from '../../packages/prisma'

import type { PartnerPayout, PayoutRecord } from './types'
import {
  aggregateByPartner,
  buildPayouts,
  buildRecord,
  findDeadlineResolved,
  findUnsettled,
  resolveWindow,
  toCsv,
} from './utils'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Run with DATABASE_URL=<url> yarn affiliate-payouts …')
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: createPrismaAdapter(2, databaseUrl) })

function printSummary(record: PayoutRecord, payouts: PartnerPayout[]): void {
  console.log('\n=== Affiliate Payout Summary ===')
  console.log(`Period:         ${record.window.start} → ${record.window.end} (${record.window.label})`)
  console.log(`Partners paid:  ${record.totals.partnersPaid}`)
  console.log(`Total USDC:     ${record.totals.totalUsdc}`)
  console.log(`Paid swaps:     ${record.totals.paidSwaps}`)
  console.log(
    `Excluded/review: ${record.totals.unpriceableSwaps} unpriceable | ${record.totals.feeAnomalySwaps} fee anomalies | ${record.totals.unverifiedSwaps} unverified | ${record.totals.unattributedSwaps} unattributed | ${record.totals.noAffiliateFeeSwaps} no-affiliate-fee | ${record.totals.partnerBpsUnsetSwaps} partner-bps-unset | ${record.totals.noVerifiedFeeSwaps} no-verified-fee`,
  )

  const top = payouts.filter((p) => p.included).slice(0, 10)
  if (top.length) {
    console.log('\n=== Top Partners ===')
    top.forEach((p, i) => {
      console.log(`${i + 1}. ${p.partnerCode} → ${p.receiveAddress}`)
      console.log(`   ${p.usdcAmount} USDC | volume $${p.volumeUsd.toFixed(2)} | ${p.swapCount} swaps`)
    })
  }

  if (record.warnings.length) {
    console.log('\n=== Warnings / review items (excluded from CSV) ===')
    record.warnings.forEach((w) => {
      const ref = w.swapId ? ` [swap ${w.swapId}]` : ''
      console.log(`- [${w.type}] ${w.partnerCode}${ref}: ${w.reason}`)
    })
  }

  if (record.deadlineResolved.length) {
    console.log('\n=== Resolved by deadline - validate manually (not paid) ===')

    // grouped so a swapper or chain that keeps timing out reads as a bug rather than a window to tune
    const groups = new Map<string, number>()
    record.deadlineResolved.forEach((d) => {
      const kind = d.stage === 'attribution' ? d.reason : d.stage === 'status' ? 'abandoned' : 'timeout'
      const key = `${d.stage} | ${d.swapperName} | ${d.chainId ?? 'unknown chain'} | ${kind}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    })
    groups.forEach((count, key) => console.log(`${String(count).padStart(4)}  ${key}`))

    console.log('')
    record.deadlineResolved.forEach((d) => {
      const tx = d.sellTxHash ? ` tx ${d.sellTxHash}` : ' no tx'
      console.log(
        `- [${d.stage}] ${d.partnerCode} [swap ${d.swapId}] ${d.swapperName} ${d.chainId ?? ''}${tx}: ${d.reason}`,
      )
    })
  }
}

function writeArtifacts(record: PayoutRecord, payouts: PartnerPayout[], force: boolean): void {
  const outputDir = path.join(__dirname, '../payouts')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const csvPath = path.join(outputDir, `affiliate-payouts-${record.window.label}.csv`)
  const jsonPath = path.join(outputDir, `affiliate-payouts-${record.window.label}.json`)

  if (!force) {
    const existing = [csvPath, jsonPath].filter((p) => fs.existsSync(p))
    if (existing.length) {
      throw new Error(
        `Refusing to overwrite existing payout artifacts (pass --force to replace):\n  ${existing.join('\n  ')}`,
      )
    }
  }

  const csv = toCsv(
    payouts
      .filter((p): p is PartnerPayout & { receiveAddress: string } => p.included && p.receiveAddress !== null)
      .map((p) => ({ receiveAddress: p.receiveAddress, usdcAmount: p.usdcAmount })),
  )

  fs.writeFileSync(csvPath, csv)
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2) + '\n')

  console.log(`\nCSV written:  ${csvPath}`)
  console.log(`JSON written: ${jsonPath}`)
}

async function generate(monthArg: string | undefined, force: boolean, allowUnsettled: boolean): Promise<void> {
  const window = resolveWindow(monthArg)
  console.log(
    `Aggregating affiliate payouts for ${window.label} (${window.start.toISOString()} → ${window.end.toISOString()})`,
  )

  // every partner swap, not just successful ones - an abandoned swap may still need a person to look at it
  const allRows = await prisma.swap.findMany({
    where: {
      partnerCode: { not: null },
      createdAt: { gte: window.start, lt: window.end },
    },
  })
  const rows = allRows.filter((row) => row.status === 'SUCCESS')
  console.log(`Found ${rows.length} successful swaps with a partner code (${allRows.length} in total)`)

  const unsettled = findUnsettled(allRows)
  if (unsettled.length) {
    console.log(`\n${unsettled.length} partner swaps are not settled yet:`)
    unsettled.forEach((u) => console.log(`- ${u.partnerCode} [swap ${u.swapId}] pending: ${u.stages.join(', ')}`))

    if (!allowUnsettled) {
      throw new Error(
        'Refusing to generate a payout with unsettled swaps - every stage resolves within 11 days of registration ' +
          '(up to 4 to settle a deposit swap, then 7 to verify), so run on or after the 12th, ' +
          'or pass --allow-unsettled to pay without them',
      )
    }
  }

  const { partners, unpriceable, anomalies, unverified, unattributed, noAffiliateFee, partnerBpsUnset, unresolvedFee } =
    aggregateByPartner(rows, { toSwap, calculateFeeForSwap, getPartnerFeeUsd })

  const affiliates = await prisma.affiliate.findMany({
    where: { partnerCode: { in: Array.from(partners.keys()) } },
    select: { partnerCode: true, receiveAddress: true, walletAddress: true },
  })

  const affiliatesByCode = new Map(affiliates.map((a) => [a.partnerCode.toLowerCase(), a]))

  const payouts = buildPayouts(partners, affiliatesByCode)

  const record = buildRecord({
    window,
    payouts,
    generatedAt: new Date().toISOString(),
    unpriceable,
    anomalies,
    unverified,
    unattributed,
    noAffiliateFee,
    partnerBpsUnset,
    unresolvedFee,
    deadlineResolved: findDeadlineResolved(allRows),
  })

  writeArtifacts(record, payouts, force)
  printSummary(record, payouts)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  const force = args.includes('--force')
  const allowUnsettled = args.includes('--allow-unsettled')
  const positional = args.slice(1).filter((a) => !a.startsWith('--'))

  try {
    switch (command) {
      case 'generate':
        await generate(positional[0], force, allowUnsettled)
        break
      default:
        console.log('Usage:')
        console.log('  DATABASE_URL=<url> affiliate-payouts generate [YYYY-MM] [--force] [--allow-unsettled]')
        console.log('    No month → previous calendar month (UTC).')
        console.log('    --force            → overwrite existing artifacts for the window.')
        console.log('    --allow-unsettled  → generate even while some swaps are still pending.')
        console.log('    Example: DATABASE_URL=<url> affiliate-payouts generate 2026-06')
        process.exit(1)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
