import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { getAssetPriceUsdAt } from '../../../../utils/pricing'
import { SwapVerificationService } from '../../../swap-verification.service'
import { failingHttp, mockHttp } from '../../../test-helpers'
import { TREASURY_ACCOUNTS } from '../relay'

import crossChainResponse from './relay.crossChain.response.json'
import crossChainSwap from './relay.crossChain.swap'
import noFeeResponse from './relay.noFee.response.json'
import noFeeSwap from './relay.noFee.swap'
import otherFeeAssetResponse from './relay.otherFeeAsset.response.json'
import otherFeeAssetSwap from './relay.otherFeeAsset.swap'
import sameChainResponse from './relay.sameChain.response.json'
import sameChainSwap from './relay.sameChain.swap'

const [TREASURY] = TREASURY_ACCOUNTS
const BASE_USDC = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

type RelayResponse = typeof sameChainResponse
type RelayRequest = RelayResponse['requests'][number]

const verify = async (swap: unknown, response: unknown) => {
  const { http, get } = mockHttp(response)
  const result = await new SwapVerificationService(http).verifySwap(swap as Swap)
  return { result, get }
}

// a copy of the same-chain response with its one request changed
const withRequest = (update: (request: RelayRequest) => void): RelayResponse => {
  const response = structuredClone(sameChainResponse)
  update(response.requests[0])
  return response
}

describe('verifyRelay', () => {
  beforeEach(() => jest.mocked(getAssetPriceUsdAt).mockReset())

  it('verifies a same-chain swap whose fee is taken in the sell asset', async () => {
    const { result, get } = await verify(sameChainSwap, sameChainResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 40,
      affiliateAddress: '0x9c9aA90363630d4ab1D9dbF416cc3BBC8d3Ed502',
      verifiedSellAmountCryptoBaseUnit: '249970000',
      actualBuyAmountCryptoBaseUnit: '13190873207415603200',
      actualAffiliateFeeAmountCryptoBaseUnit: '999880',
      actualAffiliateFeeAssetId: BASE_USDC,
      // the sell asset's price from registration, no lookup needed
      actualAffiliateFeeUsd: sameChainSwap.sellAssetUsd,
    })

    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/\/requests\/v3\?id=0x17944955.*&includeAuthenticatedData=true$/),
      { headers: { 'x-api-key': expect.any(String) as string } },
    )
    expect(getAssetPriceUsdAt).not.toHaveBeenCalled()
  })

  it('prices a fee taken in neither the sell nor the buy asset at the swap time', async () => {
    jest.mocked(getAssetPriceUsdAt).mockResolvedValue(0.9998 as never)

    const { result } = await verify(otherFeeAssetSwap, otherFeeAssetResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 40,
      verifiedSellAmountCryptoBaseUnit: '1275602200000000000',
      actualAffiliateFeeAmountCryptoBaseUnit: '99957',
      actualAffiliateFeeAssetId: BASE_USDC,
      actualAffiliateFeeUsd: '0.9998',
    })
    expect(getAssetPriceUsdAt).toHaveBeenCalledWith(BASE_USDC, otherFeeAssetSwap.createdAt)
  })

  it('takes a cross-chain swap received amount from the destination leg', async () => {
    const { result } = await verify(crossChainSwap, crossChainResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      verifiedSellAmountCryptoBaseUnit: '2393123121398350',
      actualBuyAmountCryptoBaseUnit: '67836440787444513',
      actualAffiliateFeeAmountCryptoBaseUnit: '14358738728390',
      actualAffiliateFeeAssetId: 'eip155:1/slip44:60',
      actualAffiliateFeeUsd: crossChainSwap.sellAssetUsd,
    })
  })

  it('finds no affiliate when Relay quoted a zero fee and collected none', async () => {
    const { result } = await verify(noFeeSwap, noFeeResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Relay quoted a 0 app fee and collected none',
      verifiedSellAmountCryptoBaseUnit: '211031580000000000',
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    })
  })

  it('stays PENDING while Relay has quoted a fee but not reported it collected', async () => {
    const response = withRequest(({ data }) => {
      data.appFees.actual = []
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Relay has not reported the collected app fee yet',
    })
  })

  it('stays PENDING while Relay reports a zero collected fee against a positive quote', async () => {
    const response = withRequest(({ data }) => {
      data.appFees.actual[0].amount = '0'
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Relay has not reported the collected app fee yet',
    })
  })

  it('stays PENDING while Relay has not reported the executed route', async () => {
    const response = withRequest(({ data }) => {
      delete (data.route as Partial<RelayRequest['data']['route']>).actual
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Relay has not reported the executed route yet',
    })
  })

  it('stays PENDING when the fee currency maps to no known asset', async () => {
    const response = withRequest(({ data }) => {
      delete (data.appFees as Partial<RelayRequest['data']['appFees']>).currency
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: 'Relay app fee currency has no known asset',
    })
  })

  it.each([
    ['above', '80'],
    ['below', '20'],
  ])('stays PENDING when the collected fee bps is %s what the swap charged', async (_, bps) => {
    const response = withRequest(({ data }) => {
      data.appFees.actual[0].bps = bps
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: `Relay affiliate fee of ${bps} bps differs from the swap's 40 bps`,
    })
  })

  it('stays PENDING when the sell tx is not one Relay executed for the request', async () => {
    const swap = { ...sameChainSwap, sellTxHash: `0x${'1'.repeat(64)}` }

    const { result } = await verify(swap, sameChainResponse)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', hasAffiliate: false })
    expect(result.noAffiliateReason).toMatch(/is not an origin tx of Relay request/)
  })

  it('finds the sell tx among several origin txs', async () => {
    const response = withRequest(({ data }) => {
      data.inTxs.unshift({ ...data.inTxs[0], txHash: `0x${'2'.repeat(64)}` })
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', hasAffiliate: true })
  })

  it('stays PENDING when the swap has no sell tx', async () => {
    const { result } = await verify({ ...sameChainSwap, sellTxHash: null }, sameChainResponse)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'Missing sell txHash' })
  })

  it('matches the sell tx and treasury regardless of case', async () => {
    const swap = { ...sameChainSwap, sellTxHash: sameChainSwap.sellTxHash.toUpperCase().replace('0X', '0x') }
    const response = withRequest(({ data }) => {
      data.appFees.actual[0].recipient = TREASURY
    })

    const { result } = await verify(swap, response)

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', hasAffiliate: true, affiliateAddress: TREASURY })
  })

  it.each([
    ['failure', 'FAILED'],
    ['refund', 'FAILED'],
    ['waiting', 'PENDING'],
    ['pending', 'PENDING'],
    ['submitted', 'PENDING'],
    ['delayed', 'PENDING'],
  ])('maps a %s Relay request to %s', async (status, verificationStatus) => {
    const { result } = await verify(
      sameChainSwap,
      withRequest((request) => (request.status = status)),
    )

    expect(result).toMatchObject({ verificationStatus, hasAffiliate: false })
  })

  it('credits a fee collected to the treasury on a request made before we sent our API key, which carries no referrer', async () => {
    const response = withRequest(({ data }) => {
      delete (data as { referrer?: string }).referrer
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      actualAffiliateFeeAmountCryptoBaseUnit: '999880',
    })
  })

  it('finds no affiliate when the collected fee goes to another recipient', async () => {
    const response = withRequest(({ data }) => {
      const other = '0x0000000000000000000000000000000000000001'
      data.appFees.quoted[0].recipient = other
      data.appFees.actual[0].recipient = other
    })

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Relay request carries no ShapeShift app fee',
    })
    expect(result.actualAffiliateFeeAssetId).toBeUndefined()
  })

  it('ignores a listed request whose id is not the swap relayId', async () => {
    const response = withRequest((request) => (request.id = `0x${'0'.repeat(63)}1`))

    const { result } = await verify(sameChainSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'No request data returned from Relay API',
    })
  })

  it('returns FAILED when relay metadata is missing', async () => {
    const { result } = await verify({ ...sameChainSwap, metadata: {} as SwapMetadata }, sameChainResponse)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      noAffiliateReason: 'Missing relayId in relay metadata',
    })
  })

  it('returns PENDING when the HTTP call fails (transient, retried next tick)', async () => {
    const result = await new SwapVerificationService(failingHttp()).verifySwap(sameChainSwap as Swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'upstream 500' })
  })
})
