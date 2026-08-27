import type { SwapVerificationResult } from '@shapeshift/shared-types'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { SwapMetadata, SwapperMetadata } from '@shapeshiftoss/swapper'
import { getSwapMetadata } from '@shapeshiftoss/swapper'

import type { MidgardCoin } from './types'

// Rows written before the swapperMetadata migration carry these flat keys instead.
type LegacySwapMetadata = {
  relayTransactionMetadata?: { relayId?: string }
  nearIntentsSpecific?: { depositAddress?: string }
  chainflipSwapId?: string | number
}

// getSwapMetadata throws on a discriminator mismatch, and verifySwap turns any throw into a
// retryable PENDING. Metadata never appears later, so narrow without throwing to keep FAILED.
export const tryGetSwapMetadata = <T extends SwapperMetadata['name']>(
  metadata: SwapMetadata,
  name: T,
): Extract<SwapperMetadata, { name: T }> | undefined => {
  try {
    return getSwapMetadata(metadata.swapperMetadata, name)
  } catch {
    return undefined
  }
}

// Pre-migration rows are terminal today, so nothing re-reads them — but a re-verification
// backfill would wipe their affiliate data without this.
export const getLegacySwapMetadata = (metadata: SwapMetadata): LegacySwapMetadata =>
  metadata as unknown as LegacySwapMetadata

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
