import { resolveMissingPrices, toSwap } from '../apps/swap-service/src/swaps/utils'
import { createPrismaAdapter, PrismaClient } from '../packages/prisma'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Run with DATABASE_URL=<url> yarn price-backfill …')
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: createPrismaAdapter(2, databaseUrl) })

async function run(apply: boolean): Promise<void> {
  const rows = await prisma.swap.findMany({
    where: {
      status: 'SUCCESS',
      OR: [
        { sellAssetUsd: null },
        { buyAssetUsd: null },
        { affiliateAssetUsd: null, affiliateFeeAssetId: { not: null } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Found ${rows.length} successful swaps missing a USD price${apply ? '' : ' (dry run)'}\n`)

  let filled = 0
  let unresolved = 0

  for (const row of rows) {
    const prices = await resolveMissingPrices(toSwap(row))
    const fields = Object.entries(prices)

    const missing = [
      !row.sellAssetUsd && !prices.sellAssetUsd && 'sellAssetUsd',
      !row.buyAssetUsd && !prices.buyAssetUsd && 'buyAssetUsd',
      row.affiliateFeeAssetId && !row.affiliateAssetUsd && !prices.affiliateAssetUsd && 'affiliateAssetUsd',
    ].filter(Boolean)

    const found = fields.map(([field, price]) => `${field}=${price}`).join(' ') || 'nothing found'
    const still = missing.length ? ` | still missing: ${missing.join(', ')}` : ''
    console.log(`${row.swapId} ${row.swapperName} ${row.createdAt.toISOString()} → ${found}${still}`)

    if (missing.length) unresolved++
    if (fields.length === 0) continue

    filled++
    if (apply) await prisma.swap.update({ where: { swapId: row.swapId }, data: prices })
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'} ${filled} swaps; ${unresolved} still missing a price`)
  if (!apply) console.log('Re-run with --apply to write these prices')
}

run(process.argv.includes('--apply'))
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
