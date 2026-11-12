import type { SwapVerificationResult } from '@shapeshift/shared-types'
import type { SwapMetadata, SwapperMetadata } from '@shapeshiftoss/swapper'
import * as swapper from '@shapeshiftoss/swapper'

import type { Swap } from '../swaps/types'

export const getSwapMetadata = <T extends SwapperMetadata['name']>(
  metadata: SwapMetadata,
  name: T,
): Extract<SwapperMetadata, { name: T }> | undefined => {
  try {
    return swapper.getSwapMetadata(metadata.swapperMetadata, name)
  } catch {
    return
  }
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

// a fee at other than the swap's bps, or a partner split that doesn't add up to it, would misprice payouts
export const checkAffiliateBps = (swap: Swap, result: SwapVerificationResult): SwapVerificationResult => {
  if (result.verificationStatus !== 'SUCCESS' || !result.hasAffiliate) return result

  if (result.affiliateBps !== swap.affiliateBps) {
    return noAffiliateResult(
      'PENDING',
      `${swap.swapperName} affiliate fee of ${result.affiliateBps} bps differs from the swap's ${swap.affiliateBps} bps`,
    )
  }

  if (swap.partnerBps + swap.shapeshiftBps !== swap.affiliateBps) {
    return noAffiliateResult(
      'PENDING',
      `Partner ${swap.partnerBps} bps and ShapeShift ${swap.shapeshiftBps} bps don't add up to the swap's ${swap.affiliateBps} bps`,
    )
  }

  return result
}

export const ceilDiv = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator
