import type { SwapVerificationResult } from '@shapeshift/shared-types'
import type { SwapMetadata, SwapperMetadata } from '@shapeshiftoss/swapper'
import * as swapper from '@shapeshiftoss/swapper'

import type { Verifier } from './types'

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

export const notImplemented: Verifier = () =>
  Promise.resolve(noAffiliateResult('SUCCESS', 'Verification not implemented'))
