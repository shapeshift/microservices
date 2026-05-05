import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'

import thorchainStatusResponse from './fixtures/thorchain/status-response.json'
import thorchainSwap from './fixtures/thorchain/swap'
import thorchainTxResponse from './fixtures/thorchain/tx-response.json'

const swap = thorchainSwap as unknown as Swap

const makeHttpMock = (txResponse: unknown, statusResponse: unknown): HttpService => {
  const get = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/tx/status/')) return of({ data: statusResponse })
    return of({ data: txResponse })
  })
  return { get } as unknown as HttpService
}

describe('verifyThorchain', () => {
  let service: SwapVerificationService

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('verifies a successful swap with shapeshift affiliate memo', async () => {
    service = new SwapVerificationService(makeHttpMock(thorchainTxResponse, thorchainStatusResponse))

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      isVerified: true,
      hasAffiliate: true,
      affiliateBps: 30,
      affiliateAddress: 'ss',
      verifiedSellAmountCryptoBaseUnit: '1000000000000000',
      actualBuyAmountCryptoBaseUnit: '2000',
      actualAffiliateFeeAmountCryptoBaseUnit: '3000000000000',
    })
  })

  it('strips 0x prefix from sellTxHash before calling thornode', async () => {
    const httpMock = makeHttpMock(thorchainTxResponse, thorchainStatusResponse)
    service = new SwapVerificationService(httpMock)

    await service.verifySwap(swap)

    const get = httpMock.get as unknown as jest.Mock
    const urls = get.mock.calls.map(([url]: [string]) => url)
    expect(urls.every((url: string) => !/\/(0x)/i.test(url))).toBe(true)
    expect(urls.some((url: string) => url.includes('/thorchain/tx/'))).toBe(true)
    expect(urls.some((url: string) => url.includes('/thorchain/tx/status/'))).toBe(true)
  })

  it('returns hasAffiliate=false when memo lacks the ss affiliate code', async () => {
    const txResponse = structuredClone(thorchainTxResponse)
    txResponse.observed_tx.tx.memo = '=:BTC.BTC:bc1qd5w0nndwnefa9uel2c2pqtj7tg6c4d2tlvyuvw:0:t:30'

    service = new SwapVerificationService(makeHttpMock(txResponse, thorchainStatusResponse))

    const result = await service.verifySwap(swap)

    expect(result.isVerified).toBe(true)
    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('parses bps when memo uses a streaming-swap limit (LIM/INTERVAL/QUANTITY)', async () => {
    const txResponse = structuredClone(thorchainTxResponse)
    txResponse.observed_tx.tx.memo =
      '=:BTC.BTC:bc1qd5w0nndwnefa9uel2c2pqtj7tg6c4d2tlvyuvw:0/1/0:ss:30'

    service = new SwapVerificationService(makeHttpMock(txResponse, thorchainStatusResponse))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateBps).toBe(30)
  })

  it('sums multiple out_txs to the receiveAddress (streaming-swap split outbounds)', async () => {
    const statusResponse = structuredClone(thorchainStatusResponse)
    statusResponse.out_txs = [
      {
        id: 'a',
        chain: 'BTC',
        from_address: 'bc1qvault00000000000000000000000000000000',
        to_address: 'bc1qd5w0nndwnefa9uel2c2pqtj7tg6c4d2tlvyuvw',
        coins: [{ asset: 'BTC.BTC', amount: '1200' }],
        gas: [],
        memo: 'OUT:...',
      },
      {
        id: 'b',
        chain: 'BTC',
        from_address: 'bc1qvault00000000000000000000000000000000',
        to_address: 'bc1qd5w0nndwnefa9uel2c2pqtj7tg6c4d2tlvyuvw',
        coins: [{ asset: 'BTC.BTC', amount: '800' }],
        gas: [],
        memo: 'OUT:...',
      },
    ]

    service = new SwapVerificationService(makeHttpMock(thorchainTxResponse, statusResponse))

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('2000')
  })

  it('matches the receiveAddress case-insensitively', async () => {
    const statusResponse = structuredClone(thorchainStatusResponse)
    statusResponse.out_txs[0].to_address = 'BC1QD5W0NNDWNEFA9UEL2C2PQTJ7TG6C4D2TLVYUVW'

    service = new SwapVerificationService(makeHttpMock(thorchainTxResponse, statusResponse))

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('2000')
  })

  it('ignores out_txs that are not addressed to the user (e.g. RUNE affiliate outbound)', async () => {
    const statusResponse = structuredClone(thorchainStatusResponse)
    // Drop the BTC outbound, leave only the RUNE outbound to the affiliate.
    statusResponse.out_txs = statusResponse.out_txs.filter(
      (out: { chain?: string }) => out.chain !== 'BTC',
    )

    service = new SwapVerificationService(makeHttpMock(thorchainTxResponse, statusResponse))

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBeUndefined()
  })

  it('leaves actualBuyAmountCryptoBaseUnit undefined when out_txs is missing', async () => {
    const statusResponse = structuredClone(thorchainStatusResponse) as Partial<
      typeof thorchainStatusResponse
    >
    delete statusResponse.out_txs

    service = new SwapVerificationService(makeHttpMock(thorchainTxResponse, statusResponse))

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBeUndefined()
  })

  it('returns unverified when sellTxHash is missing', async () => {
    service = new SwapVerificationService(makeHttpMock(thorchainTxResponse, thorchainStatusResponse))

    const result = await service.verifySwap({ ...swap, sellTxHash: null } as Swap)

    expect(result).toMatchObject({
      isVerified: false,
      hasAffiliate: false,
      error: 'Missing txHash for Thorchain verification',
    })
  })

  it('returns unverified when observed_tx is missing', async () => {
    service = new SwapVerificationService(makeHttpMock({}, thorchainStatusResponse))

    const result = await service.verifySwap(swap)

    expect(result.isVerified).toBe(false)
    expect(result.error).toBe('No observed transaction found')
  })

  it('returns unverified when memo is missing', async () => {
    const txResponse = structuredClone(thorchainTxResponse) as {
      observed_tx: { tx: Partial<(typeof thorchainTxResponse)['observed_tx']['tx']> }
    }
    delete txResponse.observed_tx.tx.memo

    service = new SwapVerificationService(makeHttpMock(txResponse, thorchainStatusResponse))

    const result = await service.verifySwap(swap)

    expect(result.isVerified).toBe(false)
    expect(result.error).toBe('No memo found in transaction')
  })

  it('returns unverified when the HTTP call fails', async () => {
    const httpMock = {
      get: jest.fn().mockReturnValue(throwError(() => new Error('upstream 500'))),
    } as unknown as HttpService

    service = new SwapVerificationService(httpMock)

    const result = await service.verifySwap(swap)

    expect(result.isVerified).toBe(false)
    expect(result.error).toBe('upstream 500')
  })
})
