import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'
import sameChainResponse from '../swappers/relay/__tests__/relay.sameChain.response.json'
import sameChainSwap from '../swappers/relay/__tests__/relay.sameChain.swap'
import { mockHttp } from '../test-helpers'

const verify = (swap: unknown) => new SwapVerificationService(mockHttp(sameChainResponse).http).verifySwap(swap as Swap)

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

  it('leaves a swap without a verified affiliate alone', async () => {
    const result = await verify({ ...sameChainSwap, partnerBps: 40, sellTxHash: `0x${'1'.repeat(64)}` })

    expect(result.noAffiliateReason).toMatch(/is not an origin tx/)
  })

  it('leaves a swap with no verifier PENDING', async () => {
    const result = await verify({ ...sameChainSwap, swapperName: 'Test' })

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'No verifier for Test' })
  })
})
