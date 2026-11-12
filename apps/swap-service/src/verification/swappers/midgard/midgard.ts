import { firstValueFrom } from 'rxjs'

import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import { MAYACHAIN_AFFILIATE_NAME, THORCHAIN_AFFILIATE_NAME } from '@shapeshiftoss/swapper'

import { env } from '../../../env'
import type { Verifier } from '../../types'
import { noAffiliateResult } from '../../utils'

import type { MidgardAction, MidgardActionsResponse, MidgardCoin, MidgardConfig } from './types'

const MIDGARD_PRECISION = 8

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

    // memo affiliates and fees are '/'-separated when a swap pays more than one
    const affiliates = swapMetadata.affiliateAddress.toLowerCase().split('/')
    if (!affiliates.includes(config.affiliate)) return result

    if (affiliates.length > 1) {
      return noAffiliateResult(
        'PENDING',
        `Midgard memo splits the affiliate fee across ${swapMetadata.affiliateAddress}`,
      )
    }

    const affiliateCoins = action.out.filter((out) => out.affiliate).flatMap((out) => out.coins)

    // the protocol pays affiliates in its native coin, so a payout in any other coin can't be valued yet
    if (affiliateCoins.some((coin) => coin.asset.toUpperCase() !== config.nativeAsset.asset)) {
      return noAffiliateResult('PENDING', `Midgard affiliate payout is not in ${config.nativeAsset.asset}`)
    }

    const feeAmount = affiliateCoins.reduce((total, coin) => total.plus(bnOrZero(coin.amount)), bnOrZero(0))

    // an affiliate the memo names but the protocol paid nothing earned no fee
    if (feeAmount.isZero()) {
      return { ...result, noAffiliateReason: 'Midgard action paid the ShapeShift affiliate nothing' }
    }

    return {
      ...result,
      hasAffiliate: true,
      affiliateBps: Number(swapMetadata.affiliateFee),
      affiliateAddress: config.affiliate,
      actualAffiliateFeeAmountCryptoBaseUnit: feeAmount.toFixed(0),
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
