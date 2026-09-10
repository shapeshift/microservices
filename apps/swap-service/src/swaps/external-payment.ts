import { SwapperName } from '@shapeshiftoss/swapper'

// Swappers whose sell side is a plain transfer to a provider-issued deposit address. The paying
// transaction may be built and signed outside our app, so a swap can be registered before any hash
// exists and the provider is the one that reports it.
export const EXTERNAL_PAYMENT_SWAPPERS: SwapperName[] = [SwapperName.Chainflip, SwapperName.NearIntents]

export const isExternallyPaid = (swapperName: SwapperName): boolean => EXTERNAL_PAYMENT_SWAPPERS.includes(swapperName)
