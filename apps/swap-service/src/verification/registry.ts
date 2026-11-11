import { SwapperName } from '@shapeshiftoss/swapper'

import type { Verifier } from './types'
import { noAffiliateResult, notImplemented } from './utils'
import { verifyMayachain, verifyThorchain } from './verifiers/midgard/midgard'
import { verifyNearIntents } from './verifiers/nearIntents/nearIntents'
import { verifyRelay } from './verifiers/relay/relay'

const noAffiliateFee: Verifier = () => Promise.resolve(noAffiliateResult('SUCCESS', 'Swapper charges no affiliate fee'))

export const verifiers: Record<SwapperName, Verifier> = {
  [SwapperName.Across]: notImplemented,
  [SwapperName.ArbitrumBridge]: noAffiliateFee,
  [SwapperName.Avnu]: notImplemented,
  [SwapperName.Bebop]: notImplemented,
  [SwapperName.BobGateway]: notImplemented,
  [SwapperName.ButterSwap]: notImplemented,
  [SwapperName.Cetus]: notImplemented,
  [SwapperName.Chainflip]: notImplemented,
  [SwapperName.CowSwap]: notImplemented,
  [SwapperName.Debridge]: notImplemented,
  [SwapperName.Fynd]: notImplemented,
  [SwapperName.KyberSwap]: notImplemented,
  [SwapperName.Mayachain]: verifyMayachain,
  [SwapperName.NearIntents]: verifyNearIntents,
  [SwapperName.Portals]: notImplemented,
  [SwapperName.Relay]: verifyRelay,
  [SwapperName.Stonfi]: notImplemented,
  [SwapperName.Sunio]: notImplemented,
  [SwapperName.Symbiosis]: notImplemented,
  [SwapperName.Test]: notImplemented,
  [SwapperName.Thorchain]: verifyThorchain,
  [SwapperName.Zrx]: notImplemented,
}
