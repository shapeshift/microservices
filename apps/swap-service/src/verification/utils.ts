import type { Logger } from '@nestjs/common'

import type { SwapVerificationResult } from '@shapeshift/shared-types'
import type { SwapperName } from '@shapeshiftoss/swapper'

export const THORCHAIN_PRECISION = 8

export const thorchainToNativePrecision = (thorchainAmount: string, nativePrecision: number): string => {
  const diff = nativePrecision - THORCHAIN_PRECISION
  if (diff === 0) return thorchainAmount
  if (diff > 0) return thorchainAmount + '0'.repeat(diff)
  const trimmed = thorchainAmount.slice(0, diff)
  return trimmed || '0'
}

export const logVerification = (
  logger: Logger,
  swapperName: SwapperName,
  swapId: string,
  result: SwapVerificationResult,
  extra?: Record<string, string | number | undefined>,
): void => {
  const affiliate = result.hasAffiliate
    ? `affiliate=${result.affiliateAddress} (${result.affiliateBps} bps)`
    : 'affiliate=none'

  const extras = Object.entries(extra ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)

  const segments = [
    `${swapperName} verification`,
    `swapId=${swapId}`,
    affiliate,
    `sell=${result.verifiedSellAmountCryptoBaseUnit ?? 'none'}`,
    `buy=${result.actualBuyAmountCryptoBaseUnit ?? 'none'}`,
    `fee=${result.actualAffiliateFeeAmountCryptoBaseUnit ?? 'none'}`,
    ...extras,
  ]

  logger.log(segments.join(' | '))
}
