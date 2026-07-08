import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'

import thorchainResponse from './fixtures/thorchain/response.json'
import thorchainSwap from './fixtures/thorchain/swap'

const swap = thorchainSwap as unknown as Swap

const makeHttpMock = (response: unknown): HttpService => {
  const get = jest.fn().mockReturnValue(of({ data: response }))
  return { get } as unknown as HttpService
}

describe('verifyThorchain', () => {
  let service: SwapVerificationService

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('verifies a successful swap with shapeshift affiliate', async () => {
    service = new SwapVerificationService(makeHttpMock(thorchainResponse))

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: 'ss',
      verifiedSellAmountCryptoBaseUnit: '3000000000000000',
      actualBuyAmountCryptoBaseUnit: '6643738',
      actualAffiliateFeeAmountCryptoBaseUnit: '6944500',
    })
  })

  it('strips 0x prefix from sellTxHash before calling Midgard', async () => {
    const get = jest.fn<unknown, [string]>().mockReturnValue(of({ data: thorchainResponse }))
    service = new SwapVerificationService({ get } as unknown as HttpService)

    await service.verifySwap(swap)

    const url = get.mock.calls[0][0]
    expect(url).toMatch(/\/actions\?txid=[0-9a-f]+$/i)
    expect(url).not.toMatch(/=0x/i)
  })

  it('does not attribute affiliate fields when the action affiliate is not ss', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].metadata.swap.affiliateAddress = 'other'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.affiliateBps).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('attributes affiliate with no fee amount when affiliateAddress is ss but no fee was paid out', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].out = response.actions[0].out.filter((out) => !out.affiliate)

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateAddress).toBe('ss')
    expect(result.affiliateBps).toBe(60)
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBe('0')
  })

  it('returns FAILED when sellTxHash is missing', async () => {
    service = new SwapVerificationService(makeHttpMock(thorchainResponse))

    const result = await service.verifySwap({ ...swap, sellTxHash: null } as Swap)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing sell txHash',
    })
  })

  it('returns PENDING when Midgard returns no actions', async () => {
    service = new SwapVerificationService(makeHttpMock({ actions: [] }))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('No action found in Midgard')
  })

  it('returns PENDING when the action is still pending', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].status = 'pending'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('Swap action still pending')
  })

  it('returns FAILED when the action type is not swap', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].type = 'addLiquidity'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Invalid swap action type')
  })

  it('returns FAILED when swap metadata is missing', async () => {
    const response = structuredClone(thorchainResponse) as {
      actions: Array<{ metadata: { swap?: unknown } }>
    }
    delete response.actions[0].metadata.swap

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('No swap metadata found')
  })

  it('selects the buy out by memo destination rather than array position', async () => {
    const response = structuredClone(thorchainResponse)
    // Move the destination out to the front so position-based selection would return the wrong entry.
    response.actions[0].out.reverse()

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('6643738')
  })

  it('returns FAILED when no out matches the memo destination', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].out = response.actions[0].out.map((out) =>
      out.affiliate ? out : { ...out, address: '0xdeadbeef' },
    )

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('No outbound matching memo destination')
  })

  it('returns FAILED when the action status is failed (refund)', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].status = 'failed'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Swap action failed')
  })

  it('returns FAILED when the memo has no destination address', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].metadata.swap.memo = ''

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Could not parse destination address from memo')
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
