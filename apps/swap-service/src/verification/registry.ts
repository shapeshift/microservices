import { SwapperName } from '@shapeshiftoss/swapper'

import { verifyMayachain, verifyThorchain } from './swappers/midgard/midgard'
import { verifyNearIntents } from './swappers/nearIntents/nearIntents'
import { verifyRelay } from './swappers/relay/relay'
import type { Verifier } from './types'
import { noAffiliateResult } from './utils'

const noAffiliateFee: Verifier = () => Promise.resolve(noAffiliateResult('SUCCESS', 'Swapper charges no affiliate fee'))

// swappers without a verifier stay PENDING until one is registered here
export const verifiers: Partial<Record<SwapperName, Verifier>> = {
  [SwapperName.ArbitrumBridge]: noAffiliateFee,
  [SwapperName.Mayachain]: verifyMayachain,
  [SwapperName.NearIntents]: verifyNearIntents,
  [SwapperName.Relay]: verifyRelay,
  [SwapperName.Thorchain]: verifyThorchain,
}

export const VERIFIABLE_SWAPPERS = Object.keys(verifiers) as SwapperName[]
