import type { SwapVerificationResult } from '@shapeshift/shared-types'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'

import type { MidgardCoin } from './types'

export const BPS_DENOMINATOR = 10000n
export const MIDGARD_PRECISION = 8

// Midgard normalizes every coin to 1e8 — except MAYAChain's native CACAO, which it reports at its
// own 1e10 precision. Shifting CACAO by (precision - 8) like everything else inflates it 100x.
const MIDGARD_NATIVE_PRECISION_ASSETS: Record<string, number> = { 'MAYA.CACAO': 10 }

export const midgardToNativePrecision = (coin: MidgardCoin, nativePrecision: number): string =>
  bnOrZero(coin.amount)
    .shiftedBy(nativePrecision - (MIDGARD_NATIVE_PRECISION_ASSETS[coin.asset.toUpperCase()] ?? MIDGARD_PRECISION))
    .toFixed(0, 1)

export const noAffiliateResult = (
  verificationStatus: SwapVerificationResult['verificationStatus'],
  noAffiliateReason: string,
): SwapVerificationResult => ({
  verificationStatus,
  hasAffiliate: false,
  actualBuyAmountCryptoBaseUnit: undefined,
  actualAffiliateFeeAmountCryptoBaseUnit: undefined,
  noAffiliateReason,
})

export const applyBps = (amount: string | undefined, bps: number | undefined): string | undefined => {
  if (!amount || bps === undefined) return undefined

  try {
    return ((BigInt(amount) * BigInt(bps)) / BPS_DENOMINATOR).toString()
  } catch {
    return undefined
  }
}
