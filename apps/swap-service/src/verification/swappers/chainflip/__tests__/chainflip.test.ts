import { usdcAssetId } from '@shapeshiftoss/caip'
import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'
import { failingHttp, mockHttp } from '../../../test-helpers'
import { TREASURY_ACCOUNTS } from '../chainflip'

import dcaResponse from './chainflip.dca.response.json'
import partialRefundResponse from './chainflip.partialRefund.response.json'
import refundResponse from './chainflip.refund.response.json'
import response from './chainflip.response.json'
import swap from './chainflip.swap'

const [TREASURY] = TREASURY_ACCOUNTS

type ChainflipResponse = typeof response
type ChainflipSwapRequest = ChainflipResponse['data']['swapRequest']
type ChainflipBeneficiary = ChainflipSwapRequest['beneficiaries']['nodes'][number]

const verify = async (response: unknown, overrides: Partial<Swap> = {}) => {
  const { http, post } = mockHttp(response)
  const result = await new SwapVerificationService(http).verifySwap({ ...swap, ...overrides } as Swap)
  return { result, post }
}

// a copy of the base response with its swap request changed
const withSwapRequest = (update: (swapRequest: ChainflipSwapRequest) => void): ChainflipResponse => {
  const updated = structuredClone(response)
  update(updated.data.swapRequest)
  return updated
}

const withAffiliate = (update: (affiliate: ChainflipBeneficiary) => void): ChainflipResponse =>
  withSwapRequest(({ beneficiaries }) => {
    const affiliate = beneficiaries.nodes.find(({ type }) => type === 'AFFILIATE')
    if (!affiliate) throw new Error('fixture has no AFFILIATE beneficiary')
    update(affiliate)
  })

describe('verifyChainflip', () => {
  it('verifies a swap with the ShapeShift affiliate and reports the USDC commission', async () => {
    const { result, post } = await verify(response)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: TREASURY,
      // the executed input, net of the ingress fee, not the 3200000 deposit
      verifiedSellAmountCryptoBaseUnit: '3199906',
      actualBuyAmountCryptoBaseUnit: '1989934751',
      actualAffiliateFeeAmountCryptoBaseUnit: '12010758',
      actualAffiliateFeeAssetId: usdcAssetId,
    })

    expect(post).toHaveBeenCalledWith(
      'https://chainflip-explorer.test/graphql',
      expect.objectContaining({ operationName: 'GetSwapByNativeId', variables: { nativeId: '1640208' } }),
    )
  })

  it('sums the commission of every DCA chunk', async () => {
    const { result } = await verify(dcaResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      verifiedSellAmountCryptoBaseUnit: '99999949',
      actualBuyAmountCryptoBaseUnit: '98952579',
      actualAffiliateFeeAmountCryptoBaseUnit: '367710212',
      actualAffiliateFeeAssetId: usdcAssetId,
    })
  })

  it('reports only the executed input of a partially refunded swap', async () => {
    const { result } = await verify(partialRefundResponse, { affiliateBps: 55, shapeshiftBps: 55 })

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 55,
      verifiedSellAmountCryptoBaseUnit: '42749981954282099995',
      actualBuyAmountCryptoBaseUnit: '174325505',
      actualAffiliateFeeAmountCryptoBaseUnit: '1112559655',
    })
  })

  it('fails a fully refunded swap', async () => {
    const { result } = await verify(refundResponse, { affiliateBps: 50, shapeshiftBps: 50 })

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip swap refunded',
    })
  })

  it('stays PENDING until the swap request completes', async () => {
    const { result } = await verify(
      withSwapRequest((swapRequest) => {
        swapRequest.completedEventId = null as unknown as string
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip swap request not completed yet',
    })
  })

  it('finds no affiliate when the affiliate beneficiary is not ShapeShift', async () => {
    const { result } = await verify(
      withAffiliate(({ account }) => {
        account.idSs58 = 'cFSomeoneElsesAffiliateBroker000000000000000000000'
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip swap names no ShapeShift affiliate',
      verifiedSellAmountCryptoBaseUnit: '3199906',
      actualBuyAmountCryptoBaseUnit: '1989934751',
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    })
    expect(result.affiliateBps).toBeUndefined()
  })

  it('does not attribute the shared submitter broker to ShapeShift', async () => {
    const { result } = await verify(
      withSwapRequest(({ beneficiaries }) => {
        beneficiaries.nodes = beneficiaries.nodes
          .filter(({ type }) => type !== 'AFFILIATE')
          .map((node) => ({ ...node, account: { idSs58: TREASURY } }))
      }),
    )

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', hasAffiliate: false })
  })

  it('finds no affiliate fee when the affiliate commission rate is 0 bps', async () => {
    const { result } = await verify(
      withAffiliate((affiliate) => {
        affiliate.brokerCommissionRateBps = 0
        affiliate.commissions.groupedAggregates = []
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip affiliate commission is 0 bps',
    })
  })

  it('stays PENDING while the explorer has not indexed the commission', async () => {
    const { result } = await verify(
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates = []
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip has not indexed the affiliate commission yet',
    })
  })

  it('stays PENDING when the commission spans more than one asset', async () => {
    const { result } = await verify(
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates.push({ asset: ['Usdt'], sum: { amount: '5000000' } })
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip reports affiliate commission in more than one asset',
    })
  })

  it('stays PENDING when the commission is not in USDC', async () => {
    const { result } = await verify(
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates = [{ asset: ['Usdt'], sum: { amount: '5000000' } }]
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip affiliate commission is in Usdt, not USDC',
    })
  })

  it('stays PENDING when the commission bps differs from the swap', async () => {
    const { result } = await verify(response, { affiliateBps: 50, shapeshiftBps: 50 })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: "Chainflip affiliate fee of 60 bps differs from the swap's 50 bps",
    })
  })

  it('returns FAILED when the swap metadata has no swapId', async () => {
    const { result, post } = await verify(response, {
      metadata: { quoteId: swap.metadata.quoteId, stepIndex: 0 } as SwapMetadata,
    })

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing swapId in chainflip metadata',
    })
    expect(post).not.toHaveBeenCalled()
  })

  it('stays PENDING when the explorer has no swap request yet', async () => {
    const { result } = await verify({ data: { swapRequest: null } })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'No swap request returned from the Chainflip explorer',
    })
  })

  it('stays PENDING when the explorer returns GraphQL errors', async () => {
    const { result } = await verify({ errors: [{ message: 'rate limited' }] })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip explorer error: rate limited',
    })
  })

  it('stays PENDING when the explorer request fails', async () => {
    const result = await new SwapVerificationService(failingHttp()).verifySwap(swap as unknown as Swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'upstream 500' })
  })
})
