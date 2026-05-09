import type { SwapVerificationResult } from '@shapeshift/shared-types'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'

export const BPS_DENOMINATOR = 10000n
export const THORCHAIN_PRECISION = 8

export const thorchainToNativePrecision = (thorchainAmount: string, nativePrecision: number): string =>
  bnOrZero(thorchainAmount)
    .shiftedBy(nativePrecision - THORCHAIN_PRECISION)
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
