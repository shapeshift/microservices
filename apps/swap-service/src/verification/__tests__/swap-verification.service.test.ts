import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'
import noFeeResponse from '../swappers/relay/__tests__/relay.noFee.response.json'
import noFeeSwap from '../swappers/relay/__tests__/relay.noFee.swap'
import sameChainResponse from '../swappers/relay/__tests__/relay.sameChain.response.json'
import sameChainSwap from '../swappers/relay/__tests__/relay.sameChain.swap'
import { mockHttp } from '../test-helpers'

const verify = (swap: unknown, response: unknown = sameChainResponse) =>
  new SwapVerificationService(mockHttp(response).http).verifySwap(swap as Swap)

describe('SwapVerificationService', () => {
  it('passes a verified fee whose bps and partner split match the swap', async () => {
    const result = await verify(sameChainSwap)

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', hasAffiliate: true, affiliateBps: 40 })
  })

  it('stays PENDING when the partner and ShapeShift bps do not add up to the swap bps', async () => {
    const result = await verify({ ...sameChainSwap, partnerBps: 40 })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: "Partner 40 bps and ShapeShift 10 bps don't add up to the swap's 40 bps",
    })
  })

  it('leaves a verified swap without an affiliate fee alone whatever its partner split', async () => {
    const result = await verify({ ...noFeeSwap, partnerBps: 40 }, noFeeResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Relay quoted a 0 app fee and collected none',
    })
  })

  it('leaves a swap with no verifier PENDING', async () => {
    const result = await verify({ ...sameChainSwap, swapperName: 'Test' })

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'No verifier for Test' })
  })
})
