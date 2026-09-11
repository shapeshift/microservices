import { SwapperName } from '@shapeshiftoss/swapper'

// Paid by a plain transfer to a provider-issued address, so a swap can be registered before any hash exists
export const EXTERNAL_PAYMENT_SWAPPERS: SwapperName[] = [SwapperName.Chainflip, SwapperName.NearIntents]

export const isExternallyPaid = (swapperName: SwapperName): boolean => EXTERNAL_PAYMENT_SWAPPERS.includes(swapperName)
