/**
 * One-off backfill: correct the affiliate fee asset for historical MayaChain swaps.
 *
 * Bug (fixed for new swaps in fix/mayachain-affiliate-fee-asset): Maya swaps were stored with
 * `affiliateFeeAssetId` = the sell asset, but Maya collects the affiliate fee in its native
 * asset CACAO. The stored `actualAffiliateFeeAmountCryptoBaseUnit` is the CACAO amount as
 * reported by Midgard in THORChain precision (1e8) — NOT CACAO's native precision (1e10).
 *
 * This script, for each mislabeled Maya swap:
 *   1. fetches the Midgard action by sellTxHash → block height + the affiliate CACAO fee out
 *   2. fetches the ETH.USDC pool at that height → CACAO/USD spot price (balance_asset/balance_cacao,
 *      both normalized to 1e8, so the ratio is USDC-per-CACAO ≈ USD-per-CACAO)
 *   3. plans an update:
 *        affiliateFeeAssetId                    = CACAO
 *        actualAffiliateFeeAmountCryptoBaseUnit = Midgard 1e8 amount shifted to CACAO native 1e10
 *        affiliateAssetUsd                      = historical CACAO/USD
 *
 * Swaps with no affiliate fee out are only relabeled (no amount/price).
 *
 * DEPENDS ON a companion read-path change: `resolveActualFeeUsd` currently returns null when the
 * fee asset is neither sell nor buy (precision unknown), so these values are correct-but-inert
 * until it resolves the CACAO precision (10) and uses `affiliateAssetUsd`. See notes at bottom.
 *
 * Dry-run by default. Pass --apply to write. Reads DATABASE_URL from the environment.
 *
 *   yarn backfill-maya-fee-asset            # dry run, prints planned updates
 *   yarn backfill-maya-fee-asset --apply    # execute updates
 */
import { PrismaClient } from '@prisma/client'
import BigNumber from 'bignumber.js'

const MAYACHAIN_SWAPPER = 'MAYAChain'
const CACAO_ASSET_ID = 'cosmos:mayachain-mainnet-v1/slip44:931'
const CACAO_PRECISION = 10
const MIDGARD_PRECISION = 8 // THORChain/Maya Midgard reports all amounts in 1e8

const MIDGARD_BASE = 'https://api.mayachain.shapeshift.com/midgard/v2'
const LCD_BASE = 'https://api.mayachain.shapeshift.com/lcd'
// USDC-denominated pool used as the CACAO/USD reference (USDC ≈ $1).
const USDC_POOL = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'

const prisma = new PrismaClient()

type MidgardCoin = { amount: string; asset: string }
type MidgardAction = {
  height: string
  out: { affiliate: boolean | null; coins: MidgardCoin[] }[]
}

type MayaPool = { balance_asset: string; balance_cacao: string }

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json() as Promise<T>
}

const fetchAction = async (sellTxHash: string): Promise<MidgardAction | null> => {
  const txid = sellTxHash.replace(/^0x/, '')
  const data = await getJson<{ actions: MidgardAction[] }>(`${MIDGARD_BASE}/actions?txid=${txid}`)
  return data.actions[0] ?? null
}

// The affiliate fee output, asserted to be CACAO. Returns the 1e8 amount, or null if no affiliate out.
const getCacaoFeeAmount1e8 = (action: MidgardAction): string | null => {
  const feeOut = action.out.find((o) => o.affiliate)
  if (!feeOut) return null
  const coin = feeOut.coins[0]
  if (!coin || !coin.asset.toUpperCase().endsWith('CACAO')) {
    throw new Error(`Affiliate fee out is not CACAO: ${coin?.asset}`)
  }
  return coin.amount
}

// CACAO/USD from the USDC pool at a given height. Both balances are normalized to 1e8, so the
// ratio is directly USDC-per-CACAO.
const fetchCacaoUsd = async (height: string): Promise<string> => {
  // The LCD pool endpoint returns the pool object at the top level (not wrapped in `{ pool }`).
  // balance_asset (USDC) and balance_cacao are both normalized to 1e8, so the ratio is USDC/CACAO.
  const pool = await getJson<MayaPool>(`${LCD_BASE}/mayachain/pool/${USDC_POOL}?height=${height}`)
  const cacaoUsd = new BigNumber(pool.balance_asset).div(pool.balance_cacao)
  if (!cacaoUsd.isFinite() || cacaoUsd.lte(0)) throw new Error(`Bad CACAO/USD from pool at height ${height}`)
  return cacaoUsd.toString()
}

const midgardToCacaoNative = (amount1e8: string): string =>
  new BigNumber(amount1e8).shiftedBy(CACAO_PRECISION - MIDGARD_PRECISION).toFixed(0)

type PlannedUpdate = {
  swapId: string
  affiliateFeeAssetId: string
  actualAffiliateFeeAmountCryptoBaseUnit?: string
  affiliateAssetUsd?: string
  note: string
}

const planUpdate = async (swap: {
  swapId: string
  sellTxHash: string | null
}): Promise<PlannedUpdate> => {
  const base = { swapId: swap.swapId, affiliateFeeAssetId: CACAO_ASSET_ID }

  if (!swap.sellTxHash) return { ...base, note: 'relabel only (no sellTxHash)' }

  const action = await fetchAction(swap.sellTxHash)
  if (!action) return { ...base, note: 'relabel only (no Midgard action found)' }

  const feeAmount1e8 = getCacaoFeeAmount1e8(action)
  if (!feeAmount1e8) return { ...base, note: 'relabel only (no affiliate fee out)' }

  const cacaoUsd = await fetchCacaoUsd(action.height)
  const nativeAmount = midgardToCacaoNative(feeAmount1e8)
  const feeUsd = new BigNumber(nativeAmount).shiftedBy(-CACAO_PRECISION).times(cacaoUsd)

  return {
    ...base,
    actualAffiliateFeeAmountCryptoBaseUnit: nativeAmount,
    affiliateAssetUsd: cacaoUsd,
    note: `height ${action.height} | ${feeAmount1e8} (1e8) → ${nativeAmount} (1e10) CACAO @ $${cacaoUsd} = $${feeUsd.toFixed(6)}`,
  }
}

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply')

  const swaps = await prisma.swap.findMany({
    where: {
      swapperName: MAYACHAIN_SWAPPER,
      NOT: { affiliateFeeAssetId: CACAO_ASSET_ID },
    },
    select: { swapId: true, sellTxHash: true, partnerCode: true, isAffiliateVerified: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${swaps.length} mislabeled MayaChain swaps\n`)

  let relabeled = 0
  let priced = 0
  const failures: { swapId: string; error: string }[] = []

  for (const swap of swaps) {
    try {
      const plan = await planUpdate(swap)
      const tag = swap.partnerCode ? `partner=${swap.partnerCode}` : 'shapeshift'
      console.log(`• ${plan.swapId} [${tag}] ${plan.note}`)

      if (plan.affiliateAssetUsd) priced++
      else relabeled++

      if (apply) {
        await prisma.swap.update({
          where: { swapId: plan.swapId },
          data: {
            affiliateFeeAssetId: plan.affiliateFeeAssetId,
            ...(plan.actualAffiliateFeeAmountCryptoBaseUnit && {
              actualAffiliateFeeAmountCryptoBaseUnit: plan.actualAffiliateFeeAmountCryptoBaseUnit,
            }),
            ...(plan.affiliateAssetUsd && { affiliateAssetUsd: plan.affiliateAssetUsd }),
          },
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`✗ ${swap.swapId}: ${message}`)
      failures.push({ swapId: swap.swapId, error: message })
    }
  }

  console.log(`\n${apply ? 'Applied' : 'Planned'}: ${priced} priced + ${relabeled} relabel-only; ${failures.length} failed`)
  if (!apply) console.log('Re-run with --apply to write these changes.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
