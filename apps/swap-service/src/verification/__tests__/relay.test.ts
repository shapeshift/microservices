import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'

import relayResponse from './fixtures/relay/response.json'
import relaySwap from './fixtures/relay/swap'

const swap = relaySwap as unknown as Swap

const DAO_TREASURY_BASE = '0x9c9aA90363630d4ab1D9dbF416cc3BBC8d3Ed502'

type RelayResponse = typeof relayResponse
type RelayRequestData = RelayResponse['requests'][0]['data']

const makeHttpMock = (response: unknown) => {
  const get = jest.fn().mockReturnValue(of({ data: response }))
  return { http: { get } as unknown as HttpService, get }
}

const verify = (response: unknown) => {
  const { http, get } = makeHttpMock(response)
  return { result: new SwapVerificationService(http).verifySwap(swap), get }
}

describe('verifyRelay', () => {
  it('verifies a request made with our API key from its authenticated referrer', async () => {
    const { result, get } = verify(relayResponse)

    await expect(result).resolves.toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: DAO_TREASURY_BASE,
      verifiedSellAmountCryptoBaseUnit: '1000000000000000',
      actualBuyAmountCryptoBaseUnit: '2272662',
      actualAffiliateFeeAmountCryptoBaseUnit: '6000000000000',
      actualAffiliateFeeAssetId: 'eip155:1/slip44:60',
    })

    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/\/requests\/v3\?id=0xee63.*&includeAuthenticatedData=true$/),
      { headers: { 'x-api-key': expect.any(String) as string } },
    )
  })

  it('returns hasAffiliate=false for a request without our referrer, such as one made without our API key', async () => {
    const response = structuredClone(relayResponse)
    delete (response.requests[0].data as Partial<RelayRequestData>).referrer

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({ verificationStatus: 'SUCCESS', hasAffiliate: false })
  })

  it('returns hasAffiliate=false when the referrer is not shapeshift', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.referrer = 'someone-else'

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      affiliateBps: undefined,
      affiliateAddress: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAssetId: undefined,
    })
  })

  it('ignores a listed request whose id is not the swap relayId', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].id = '0x0000000000000000000000000000000000000000000000000000000000000001'

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'No request data returned from Relay API',
    })
  })

  it('returns hasAffiliate=false when no app fee goes to the BASE treasury', async () => {
    const response = structuredClone(relayResponse)
    const other = { recipient: '0x0000000000000000000000000000000000000001', bps: '50', amount: '500000000000' }
    response.requests[0].data.appFees.quoted = [{ ...other, amountFormatted: '0.0000005' }]
    response.requests[0].data.appFees.actual = [{ ...other, amountFormatted: '0.0000005', amountUsd: '0.001' }]

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({ hasAffiliate: false, actualAffiliateFeeAssetId: undefined })
  })

  it('matches the BASE treasury recipient case-insensitively', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees.actual[0].recipient = DAO_TREASURY_BASE.toLowerCase()

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({
      hasAffiliate: true,
      affiliateAddress: DAO_TREASURY_BASE.toLowerCase(),
    })
  })

  it('prefers the fee actually collected over the quoted one', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees.actual[0].amount = '5900000000000'

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({ actualAffiliateFeeAmountCryptoBaseUnit: '5900000000000' })
  })

  it('falls back to the quoted fee until Relay reports the actual one', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees.actual = []

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({
      hasAffiliate: true,
      affiliateBps: 60,
      actualAffiliateFeeAmountCryptoBaseUnit: '6000000000000',
    })
  })

  it('builds an erc20 actualAffiliateFeeAssetId when the app fee currency is a token', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees.currency = {
      ...response.requests[0].data.appFees.currency,
      chainId: 1,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    }

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({
      actualAffiliateFeeAssetId: 'eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7',
    })
  })

  it('leaves actualAffiliateFeeAssetId undefined when the app fee currency is missing', async () => {
    const response = structuredClone(relayResponse)
    delete (response.requests[0].data.appFees as Partial<RelayRequestData['appFees']>).currency

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({ actualAffiliateFeeAssetId: undefined })
  })

  it('takes a cross-chain swap received amount from the destination leg, not the origin output', async () => {
    const response = structuredClone(relayResponse) as RelayResponse & {
      requests: { data: { route: { actual: { destination: unknown } } } }[]
    }
    response.requests[0].data.route.actual.destination = { outputCurrency: { amount: '2250000' } }

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({ actualBuyAmountCryptoBaseUnit: '2250000' })
  })

  it('returns affiliateBps=undefined when bps is non-numeric (avoids NaN)', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees.actual[0].bps = 'not-a-number'

    const { result } = verify(response)

    await expect(result).resolves.toMatchObject({ hasAffiliate: true, affiliateBps: undefined })
  })

  it('returns FAILED when relay metadata is missing', async () => {
    const { http } = makeHttpMock(relayResponse)
    const swapWithoutMetadata = { ...swap, metadata: {} as SwapMetadata } as Swap

    const result = await new SwapVerificationService(http).verifySwap(swapWithoutMetadata)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing relayId in relay metadata',
    })
  })

  it('returns PENDING when the API returns no requests (transient — retry next tick)', async () => {
    const { result } = verify({ requests: [] })

    await expect(result).resolves.toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'No request data returned from Relay API',
    })
  })

  it('returns PENDING when the HTTP call fails (transient — retry next tick)', async () => {
    const httpMock = {
      get: jest.fn().mockReturnValue(throwError(() => new Error('upstream 500'))),
    } as unknown as HttpService

    const result = await new SwapVerificationService(httpMock).verifySwap(swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'upstream 500' })
  })
})
