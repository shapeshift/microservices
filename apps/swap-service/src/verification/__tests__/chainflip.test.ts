import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { SwapperSpecificMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'

import chainflipResponse from './fixtures/chainflip/response.json'
import chainflipSwap from './fixtures/chainflip/swap'

const swap = chainflipSwap as unknown as Swap

const SHAPESHIFT_AFFILIATE_SS58 = 'cFMeDPtPHccVYdBSJKTtCYuy7rewFNpro3xZBKaCGbSS2xhRi'
const USDC_ASSET_ID = 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const makeHttpMock = (response: unknown): HttpService =>
  ({ post: jest.fn().mockReturnValue(of({ data: response })) }) as unknown as HttpService

const affiliateNode = (response: typeof chainflipResponse) => {
  const node = response.data.swapRequest.beneficiaries.nodes.find((n) => n.type === 'AFFILIATE')
  if (!node) throw new Error('fixture has no AFFILIATE beneficiary')
  return node
}

describe('verifyChainflip', () => {
  let service: SwapVerificationService

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('verifies a successful swap with matching affiliate broker and reports the USDC commission', async () => {
    service = new SwapVerificationService(makeHttpMock(chainflipResponse))

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: SHAPESHIFT_AFFILIATE_SS58,
      // executed swap input (deposit 3200000 minus the 94 ingress fee), not the gross deposit
      verifiedSellAmountCryptoBaseUnit: '3199906',
      actualBuyAmountCryptoBaseUnit: '1989934751',
      actualAffiliateFeeAmountCryptoBaseUnit: '12010758',
      actualAffiliateFeeAssetId: USDC_ASSET_ID,
    })
  })

  it('verifies a DCA swap — multiple chunks aggregate into a single USDC commission group', async () => {
    const response = structuredClone(chainflipResponse)
    response.data.swapRequest.executedSwaps.aggregates.sum.swapInputAmount = '99990000'
    response.data.swapRequest.egress.amount = '98952579'
    affiliateNode(response).commissions.groupedAggregates = [
      { asset: ['Usdc'], sum: { amount: '367710212', valueUsd: '367.657975178100000000000000000000' } },
    ]

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(true)
    expect(result.verifiedSellAmountCryptoBaseUnit).toBe('99990000')
    expect(result.actualBuyAmountCryptoBaseUnit).toBe('98952579')
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBe('367710212')
    expect(result.actualAffiliateFeeAssetId).toBe(USDC_ASSET_ID)
  })

  it('reports the executed sell amount (not the gross deposit) on a partial FoK refund', async () => {
    const response = structuredClone(chainflipResponse)
    // deposit is 3200000; only 2000000 actually swapped, the remainder refunded
    response.data.swapRequest.executedSwaps.aggregates.sum.swapInputAmount = '2000000'
    response.data.swapRequest.egress.amount = '1200000000'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(true)
    expect(result.verifiedSellAmountCryptoBaseUnit).toBe('2000000')
    expect(result.actualBuyAmountCryptoBaseUnit).toBe('1200000000')
  })

  it('matches the affiliate broker SS58 case-insensitively', async () => {
    const response = structuredClone(chainflipResponse)
    affiliateNode(response).account.idSs58 = SHAPESHIFT_AFFILIATE_SS58.toLowerCase()

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(true)
    expect(result.affiliateBps).toBe(60)
  })

  it('returns hasAffiliate=false when the affiliate beneficiary is not our broker', async () => {
    const response = structuredClone(chainflipResponse)
    affiliateNode(response).account.idSs58 = 'cFSomeoneElsesAffiliateBroker000000000000000000000'

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
    expect(result.actualAffiliateFeeAssetId).toBeUndefined()
    expect(result.actualAffiliateAssetUsd).toBeUndefined()
    expect(result.verifiedSellAmountCryptoBaseUnit).toBe('3199906')
    expect(result.actualBuyAmountCryptoBaseUnit).toBe('1989934751')
  })

  it('returns hasAffiliate=false when there is no AFFILIATE beneficiary (submitter only)', async () => {
    const response = structuredClone(chainflipResponse)
    const nodes = response.data.swapRequest.beneficiaries.nodes
    response.data.swapRequest.beneficiaries.nodes = nodes.filter((node) => node.type !== 'AFFILIATE')

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
  })

  // Empty commission arises two ways: (1) the BaaS-Confirmed-early vs explorer-indexing race, and
  // (2) a fully-refunded FoK swap (no swap executed → no commission). Both resolve to PENDING here;
  // case (2) never actually reaches verification (no swap egress → stays tx-status PENDING).
  it('returns PENDING when the affiliate commission is empty (indexing race / full refund)', async () => {
    const response = structuredClone(chainflipResponse)
    affiliateNode(response).commissions.groupedAggregates = []

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.hasAffiliate).toBe(false)
    expect(result.noAffiliateReason).toContain('commission not yet indexed')
  })

  it('returns FAILED when the affiliate commission spans multiple asset groups', async () => {
    const response = structuredClone(chainflipResponse)
    affiliateNode(response).commissions.groupedAggregates = [
      { asset: ['Usdc'], sum: { amount: '12010758', valueUsd: '12.0' } },
      { asset: ['Usdt'], sum: { amount: '5000000', valueUsd: '5.0' } },
    ]

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.hasAffiliate).toBe(false)
    expect(result.noAffiliateReason).toContain('2 group(s)')
  })

  it('returns FAILED when the affiliate commission is in an unmapped (non-USDC) asset', async () => {
    const response = structuredClone(chainflipResponse)
    affiliateNode(response).commissions.groupedAggregates = [
      { asset: ['Usdt'], sum: { amount: '5000000', valueUsd: '5.0' } },
    ]

    service = new SwapVerificationService(makeHttpMock(response))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.hasAffiliate).toBe(false)
    expect(result.noAffiliateReason).toContain('Unexpected Chainflip commission')
    expect(result.noAffiliateReason).toContain('Usdt')
  })

  it('returns FAILED when metadata.chainflipSwapId is missing', async () => {
    const swapWithoutMetadata = { ...swap, metadata: {} as SwapperSpecificMetadata } as Swap

    service = new SwapVerificationService(makeHttpMock(chainflipResponse))

    const result = await service.verifySwap(swapWithoutMetadata)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing chainflipSwapId in metadata',
    })
  })

  it('returns PENDING when the explorer returns a null swapRequest (indexer lag — retry next tick)', async () => {
    service = new SwapVerificationService(makeHttpMock({ data: { swapRequest: null } }))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('No swap request found from Chainflip explorer')
  })

  it('returns PENDING when the HTTP call fails (transient — retry next tick)', async () => {
    const httpMock = {
      post: jest.fn().mockReturnValue(throwError(() => new Error('upstream 500'))),
    } as unknown as HttpService

    service = new SwapVerificationService(httpMock)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('upstream 500')
  })
})
