import { firstValueFrom } from 'rxjs'

import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import { MAYACHAIN_AFFILIATE_NAME, THORCHAIN_AFFILIATE_NAME } from '@shapeshiftoss/swapper'

import { env } from '../../../env'
import type { Verifier } from '../../types'
import { noAffiliateResult } from '../../utils'

const MIDGARD_PRECISION = 8

type MidgardCoin = {
  amount: string
  asset: string
}

// GET /v2/actions, trimmed to the fields verification reads
type MidgardAction = {
  type: string
  status: 'pending' | 'success' | 'failed'
  in: Array<{ txID: string; coins: MidgardCoin[] }>
  out: Array<{ address: string; affiliate?: boolean; coins: MidgardCoin[] }>
  metadata: {
    swap?: {
      affiliateAddress: string
      affiliateFee: string
      memo: string
    }
  }
}

type MidgardActionsResponse = {
  actions: MidgardAction[]
}

type MidgardConfig = {
  midgardUrl: string
  affiliate: string
  // the chain's native coin, which the affiliate fee is paid in
  nativeAsset: { asset: string; precision: number }
}

// Midgard normalizes every coin to 1e8 except the chain's native coin, which it reports at its own precision
const toNativePrecision = (coin: MidgardCoin, precision: number, config: MidgardConfig): string => {
  const isNativeAsset = coin.asset.toUpperCase() === config.nativeAsset.asset
  const midgardPrecision = isNativeAsset ? config.nativeAsset.precision : MIDGARD_PRECISION

  return bnOrZero(coin.amount)
    .shiftedBy(precision - midgardPrecision)
    .toFixed(0, 1)
}

const midgardVerifier =
  (config: MidgardConfig): Verifier =>
  async (swap, { http }) => {
    const txHash = swap.sellTxHash?.replace(/^0x/, '')
    if (!txHash) return noAffiliateResult('FAILED', 'Missing sell txHash')

    const { data } = await firstValueFrom(
      http.get<MidgardActionsResponse>(`${config.midgardUrl}/actions?txid=${txHash}`),
    )

    const isSellTx = ({ txID }: MidgardAction['in'][number]) => txID.toUpperCase() === txHash.toUpperCase()

    const matches = data.actions.flatMap((action) => {
      const sellIn = action.in.find(isSellTx)
      return sellIn ? [{ action, sellIn }] : []
    })
    if (!matches.length) return noAffiliateResult('PENDING', 'No action found in Midgard')

    // a streaming swap that only partially fills has a refund action alongside the swap action for the filled part
    const match = matches.find(({ action }) => action.type === 'swap')
    if (!match) return noAffiliateResult('FAILED', 'Invalid swap action type')

    const { action, sellIn } = match
    if (action.status === 'pending') return noAffiliateResult('PENDING', 'Swap action still pending')
    if (action.status === 'failed') return noAffiliateResult('FAILED', 'Swap action failed')

    const swapMetadata = action.metadata.swap
    if (!swapMetadata) return noAffiliateResult('FAILED', 'No swap metadata found')

    // memo format: =:ASSET:DESTADDR[/REFUNDADDR]:LIM/INTERVAL/QUANTITY:AFFILIATE:FEE
    // the destination is what Midgard observed on-chain, so it's the trusted source for matching the buy out
    const destinationAddress = swapMetadata.memo.split(':')[2]?.split('/')[0]?.toLowerCase()
    if (!destinationAddress) return noAffiliateResult('FAILED', 'Could not parse destination address from memo')

    // a large outbound can be paid from several vaults, and a partial refund can go to the same address in the sell coin
    const buyOuts = action.out.filter(
      (out) =>
        !out.affiliate &&
        out.address.toLowerCase() === destinationAddress &&
        out.coins[0]?.asset !== sellIn.coins[0]?.asset,
    )
    if (!buyOuts.length) return noAffiliateResult('FAILED', 'No outbound matching memo destination')

    const buyAmount = buyOuts.reduce(
      (total, out) => total.plus(toNativePrecision(out.coins[0], swap.buyAsset.precision, config)),
      bnOrZero(0),
    )

    const result = {
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      verifiedSellAmountCryptoBaseUnit: toNativePrecision(sellIn.coins[0], swap.sellAsset.precision, config),
      actualBuyAmountCryptoBaseUnit: buyAmount.toFixed(0),
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    } as const

    if (swapMetadata.affiliateAddress.toLowerCase() !== config.affiliate) return result

    // a fee other than the one charged would misprice payouts
    const affiliateBps = Number(swapMetadata.affiliateFee)
    if (affiliateBps !== swap.affiliateBps) {
      return noAffiliateResult(
        'PENDING',
        `Midgard affiliate fee of ${swapMetadata.affiliateFee} bps differs from the swap's ${swap.affiliateBps} bps`,
      )
    }

    // the protocol pays affiliates in its native coin, so any other coin is not a fee we can value
    const feeCoin = action.out
      .find((out) => out.affiliate && out.coins[0]?.asset.toUpperCase() === config.nativeAsset.asset)
      ?.coins[0]

    return {
      ...result,
      hasAffiliate: true,
      affiliateBps,
      affiliateAddress: config.affiliate,
      actualAffiliateFeeAmountCryptoBaseUnit: feeCoin?.amount ?? '0',
    }
  }

export const verifyThorchain = midgardVerifier({
  midgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
  affiliate: THORCHAIN_AFFILIATE_NAME,
  nativeAsset: { asset: 'THOR.RUNE', precision: 8 },
})

export const verifyMayachain = midgardVerifier({
  midgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
  affiliate: MAYACHAIN_AFFILIATE_NAME,
  // CACAO is 1e10, so shifting it from 1e8 like other coins would inflate it 100x
  nativeAsset: { asset: 'MAYA.CACAO', precision: 10 },
})
