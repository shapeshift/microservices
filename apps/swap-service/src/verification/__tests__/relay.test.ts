import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'

import relayResponse from './fixtures/relay/response.json'
import relaySwap from './fixtures/relay/swap'

const swap = relaySwap as unknown as Swap

const DAO_TREASURY_BASE = '0x9c9aA90363630d4ab1D9dbF416cc3BBC8d3Ed502'

const makeHttpMock = (response: unknown): HttpService =>
  ({ get: jest.fn().mockReturnValue(of({ data: response })) }) as unknown as HttpService

describe('verifyRelay', () => {
  let service: SwapVerificationService

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('verifies a successful swap with shapeshift referrer and matching appFee recipient', async () => {
    service = new SwapVerificationService(makeHttpMock(relayResponse))

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: DAO_TREASURY_BASE,
      verifiedSellAmountCryptoBaseUnit: '1000000000000000',
      actualBuyAmountCryptoBaseUnit: '2272662',
      actualAffiliateFeeAmountCryptoBaseUnit: '6000000000000',
      actualAffiliateFeeAssetId: 'eip155:1/slip44:60',
    })
  })

  it('builds an erc20 actualAffiliateFeeAssetId when appFeeCurrencyObject is a token', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFeeCurrencyObject = {
      chainId: 1,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      metadata: { logoURI: '', verified: true },
    }

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.actualAffiliateFeeAssetId).toBe('eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7')
  })

  it('leaves actualAffiliateFeeAssetId undefined when appFeeCurrencyObject is missing', async () => {
    const response = structuredClone(relayResponse)
    delete (response.requests[0].data as Partial<(typeof response.requests)[0]['data']>).appFeeCurrencyObject

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.actualAffiliateFeeAssetId).toBeUndefined()
  })

  it('returns hasAffiliate=false when referrer is not shapeshift', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].referrer = 'someone-else'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
    expect(result.actualAffiliateFeeAssetId).toBeUndefined()
  })

  it('returns hasAffiliate=false when referrer is shapeshift but no appFee matches the BASE treasury', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees = [
      {
        recipient: '0x0000000000000000000000000000000000000001',
        bps: '50',
        amount: '500000000000',
        amountUsd: '1.0',
        amountUsdCurrent: '1.0',
      },
    ]
    response.requests[0].data.paidAppFees = []

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
    expect(result.actualAffiliateFeeAssetId).toBeUndefined()
  })

  it('matches the BASE treasury recipient case-insensitively', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees[0].recipient = DAO_TREASURY_BASE.toLowerCase()

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateAddress).toBe(DAO_TREASURY_BASE.toLowerCase())
  })

  it('falls back to paidAppFees when appFees is missing', async () => {
    const response = structuredClone(relayResponse)
    delete (response.requests[0].data as Partial<(typeof response.requests)[0]['data']>).appFees

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateBps).toBe(60)
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBe('6000000000000')
  })

  it('falls back to paidAppFees when appFees is an empty array', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees = []

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateBps).toBe(60)
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBe('6000000000000')
  })

  it('leaves actualBuyAmountCryptoBaseUnit undefined when currencyOut is missing', async () => {
    const response = structuredClone(relayResponse)
    delete (response.requests[0].data.metadata as Partial<(typeof response.requests)[0]['data']['metadata']>)
      .currencyOut

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBeUndefined()
  })

  it('returns affiliateBps=undefined when bps is non-numeric (avoids NaN)', async () => {
    const response = structuredClone(relayResponse)
    response.requests[0].data.appFees[0].bps = 'not-a-number'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateBps).toBeUndefined()
  })

  it('uses appFee.amount directly for actualAffiliateFeeAmountCryptoBaseUnit (not bps × sell)', async () => {
    const response = structuredClone(relayResponse)
    // Set an amount that does NOT match bps × sell so the test fails if applyBps were used.
    response.requests[0].data.appFees[0].amount = '999'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBe('999')
  })

  it('returns FAILED when relay metadata is missing', async () => {
    const swapWithoutMetadata = { ...swap, metadata: {} as SwapMetadata } as Swap

    service = new SwapVerificationService(makeHttpMock(relayResponse))

    const result = await service.verifySwap(swapWithoutMetadata)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing relayId in relay metadata',
    })
  })

  it('returns PENDING when API returns no requests (transient — retry next tick)', async () => {
    service = new SwapVerificationService(makeHttpMock({ requests: [] }))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('No request data returned from Relay API')
  })

  it('returns PENDING when the HTTP call fails (transient — retry next tick)', async () => {
    const httpMock = {
      get: jest.fn().mockReturnValue(throwError(() => new Error('upstream 500'))),
    } as unknown as HttpService

    service = new SwapVerificationService(httpMock)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('upstream 500')
  })
})
