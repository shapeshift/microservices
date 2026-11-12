import { SwapperName } from '@shapeshiftoss/swapper'

import type { Swap } from '../../swaps/types'
import { VERIFIABLE_SWAPPERS } from '../registry'
import { SwapVerificationService } from '../swap-verification.service'
import { mockHttp } from '../test-helpers'

describe('verifier registry', () => {
  it('polls exactly the swappers that have a verifier', () => {
    expect([...VERIFIABLE_SWAPPERS].sort()).toEqual(
      [
        SwapperName.ArbitrumBridge,
        SwapperName.Mayachain,
        SwapperName.NearIntents,
        SwapperName.Relay,
        SwapperName.Thorchain,
      ].sort(),
    )
  })

  it('verifies an Arbitrum Bridge swap without an affiliate fee and without calling out', async () => {
    const { http, get } = mockHttp({})

    const result = await new SwapVerificationService(http).verifySwap({
      swapId: 'arb',
      swapperName: SwapperName.ArbitrumBridge,
      affiliateBps: 0,
    } as Swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Swapper charges no affiliate fee',
    })
    expect(get).not.toHaveBeenCalled()
  })
})
