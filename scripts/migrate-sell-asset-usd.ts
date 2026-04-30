import { Prisma, PrismaClient } from '@prisma/client'
import * as fs from 'fs'

const prisma = new PrismaClient()

type LegacySwap = {
  swapId: string
  sellAsset: { precision: number } & Record<string, unknown>
  buyAsset: Record<string, unknown>
  sellAmountCryptoBaseUnit: string
  expectedBuyAmountCryptoBaseUnit: string
  actualBuyAmountCryptoBaseUnit: string | null
  status: string
  source: string
  swapperName: string
  sellAccountId: string
  buyAccountId: string | null
  receiveAddress: string | null
  sellTxHash: string | null
  buyTxHash: string | null
  txLink: string | null
  statusMessage: string | null
  isStreaming: boolean
  createdAt: Date
  updatedAt: Date
  metadata: Record<string, unknown>
  userId: string
  referralCode: string | null
  sellAmountUsd: string | null
  buyAssetUsd: string | null
  affiliateAssetUsd: string | null
  isAffiliateVerified: boolean | null
  affiliateVerificationDetails: Record<string, unknown> | null
  affiliateAddress: string | null
  affiliateBps: number | null
  origin: string | null
  affiliateFeeAssetId: string | null
  actualAffiliateFeeAmountCryptoBaseUnit: string | null
  shapeshiftBps: number
}

type ExportedSwap = Omit<LegacySwap, 'sellAmountUsd'> & { sellAssetUsd: string | null }

const computeSellAssetUsd = (row: LegacySwap): string | null => {
  if (!row.sellAmountUsd) return null
  const sellAmount = Number(row.sellAmountCryptoBaseUnit) / 10 ** row.sellAsset.precision
  if (sellAmount <= 0) return null
  return (Number(row.sellAmountUsd) / sellAmount).toString()
}

const exportSwaps = async (outputPath: string): Promise<void> => {
  const rows = await prisma.$queryRawUnsafe<LegacySwap[]>(`SELECT * FROM "public"."swaps"`)

  console.log(`Read ${rows.length} swaps`)

  const exported: ExportedSwap[] = rows.map((row) => {
    const { sellAmountUsd: _, ...rest } = row
    return { ...rest, sellAssetUsd: computeSellAssetUsd(row) }
  })

  fs.writeFileSync(outputPath, JSON.stringify(exported, null, 2))
  console.log(`Wrote ${exported.length} swaps to ${outputPath}`)
}

const importSwaps = async (inputPath: string): Promise<void> => {
  const raw = fs.readFileSync(inputPath, 'utf-8')
  const swaps = JSON.parse(raw) as ExportedSwap[]

  console.log(`Read ${swaps.length} swaps from ${inputPath}`)

  const data: Prisma.SwapCreateManyInput[] = swaps.map((swap) => ({
    ...swap,
    sellAsset: swap.sellAsset as unknown as Prisma.InputJsonValue,
    buyAsset: swap.buyAsset as Prisma.InputJsonValue,
    metadata: swap.metadata as Prisma.InputJsonValue,
    affiliateVerificationDetails: (swap.affiliateVerificationDetails ?? Prisma.DbNull) as Prisma.InputJsonValue,
    createdAt: new Date(swap.createdAt),
    updatedAt: new Date(swap.updatedAt),
  }))

  const result = await prisma.swap.createMany({ data, skipDuplicates: true })
  console.log(`Inserted ${result.count} swaps`)
}

const main = async (): Promise<void> => {
  const [command, filePath] = process.argv.slice(2)

  if (!command || !filePath) {
    console.log('Usage:')
    console.log('  DATABASE_URL=... yarn ts-node scripts/migrate-sell-asset-usd.ts export <output.json>')
    console.log('  DATABASE_URL=... yarn ts-node scripts/migrate-sell-asset-usd.ts import <input.json>')
    process.exit(1)
  }

  switch (command) {
    case 'export':
      await exportSwaps(filePath)
      break
    case 'import':
      await importSwaps(filePath)
      break
    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
