import type { SwapVerificationResult } from '@shapeshift/shared-types'

export const BPS_DENOMINATOR = 10000n
export const THORCHAIN_PRECISION = 8

export const thorchainToNativePrecision = (thorchainAmount: string, nativePrecision: number): string => {
  const diff = nativePrecision - THORCHAIN_PRECISION
  if (diff === 0) return thorchainAmount
  if (diff > 0) return thorchainAmount + '0'.repeat(diff)
  const trimmed = thorchainAmount.slice(0, diff)
  return trimmed || '0'
}

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
