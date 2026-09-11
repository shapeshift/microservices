import type { SwapperName } from '@shapeshiftoss/swapper'
import { swappers } from '@shapeshiftoss/swapper'

// Paid by a plain transfer to a provider-issued address, so a swap can be registered before any hash exists
export const isExternallyPaid = (swapperName: SwapperName): boolean =>
  swappers[swapperName]?.supportsExternalPayment === true

export const getExternalPaymentSwappers = (): SwapperName[] =>
  (Object.keys(swappers) as SwapperName[]).filter(isExternallyPaid)
