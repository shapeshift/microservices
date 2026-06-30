import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

import { calculateFeeForSwap, getPartnerFeeRate, toSwap } from '../apps/swap-service/src/swaps/utils'

import {
  aggregateByPartner,
  buildPayouts,
  buildRecord,
  type PartnerPayout,
  type PayoutRecord,
  resolveWindow,
  toCsv,
} from './affiliate-payouts-lib'

const prisma = new PrismaClient()

const printSummary = (record: PayoutRecord, payouts: PartnerPayout[]): void => {
  console.log('\n=== Affiliate Payout Summary ===')
  console.log(`Period:         ${record.window.start} → ${record.window.end} (${record.window.label})`)
  console.log(`Partners paid:  ${record.totals.partnersPaid}`)
  console.log(`Total USDC:     ${record.totals.totalUsdc}`)
  console.log(
    `Eligible swaps: ${record.totals.eligibleSwaps} | Skipped (unpriceable): ${record.totals.skippedSwaps} | Fee anomalies excluded: ${record.totals.anomalousSwaps}`,
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
    console.log('\n=== Warnings (excluded from CSV) ===')
    record.warnings.forEach((w) => {
      const ref = w.swapId ? ` [swap ${w.swapId}]` : ''
      console.log(`- [${w.type}] ${w.partnerCode}${ref}: ${w.reason}`)
    })
  }
}

const writeArtifacts = (record: PayoutRecord, payouts: PartnerPayout[]): void => {
  const outputDir = path.join(__dirname, '../payouts')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })

  const csv = toCsv(
    payouts
      .filter((p) => p.included && p.receiveAddress)
      .map((p) => ({ receiveAddress: p.receiveAddress as string, usdcAmount: p.usdcAmount })),
  )

  const csvPath = path.join(outputDir, `affiliate-payouts-${record.window.label}.csv`)
  const jsonPath = path.join(outputDir, `affiliate-payouts-${record.window.label}.json`)

  fs.writeFileSync(csvPath, csv)
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2) + '\n')

  console.log(`\nCSV written:  ${csvPath}`)
  console.log(`JSON written: ${jsonPath}`)
}

const generate = async (startArg?: string, endArg?: string): Promise<void> => {
  const window = resolveWindow(startArg, endArg)
  console.log(
    `Aggregating affiliate payouts for ${window.label} (${window.start.toISOString()} → ${window.end.toISOString()})`,
  )

  const rows = await prisma.swap.findMany({
    where: {
      partnerCode: { not: null },
      status: 'SUCCESS',
      isAffiliateVerified: true,
      createdAt: { gte: window.start, lt: window.end },
    },
  })
  console.log(`Found ${rows.length} verified successful swaps with a partner code`)

  const { partners, skippedSwaps, anomalies } = aggregateByPartner(rows, {
    toSwap,
    calculateFeeForSwap,
    getPartnerFeeRate,
  })

  const affiliates = await prisma.affiliate.findMany({
    where: { partnerCode: { in: Array.from(partners.keys()) } },
    select: { partnerCode: true, receiveAddress: true, walletAddress: true },
  })
  const affiliatesByCode = new Map(affiliates.map((a) => [a.partnerCode, a]))

  const payouts = buildPayouts(partners, affiliatesByCode)
  const record = buildRecord(window, payouts, skippedSwaps, anomalies, new Date().toISOString())

  writeArtifacts(record, payouts)
  printSummary(record, payouts)
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const command = args[0]

  try {
    switch (command) {
      case 'generate':
        await generate(args[1], args[2])
        break
      default:
        console.log('Usage:')
        console.log('  affiliate-payouts generate [startDate] [endDate]')
        console.log('    No dates → previous calendar month (UTC).')
        console.log('    Example: affiliate-payouts generate 2026-06-01 2026-07-01')
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
