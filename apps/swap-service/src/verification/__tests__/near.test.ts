import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript'
import type { HttpService } from '@nestjs/axios'

import type { SwapperSpecificMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../swaps/types'
import { SwapVerificationService } from '../swap-verification.service'

import nearResponse from './fixtures/near/response.json'
import nearSwap from './fixtures/near/swap'

const swap = nearSwap as unknown as Swap

describe('verifyNearIntents', () => {
  let service: SwapVerificationService

  beforeEach(() => {
    // verifyNearIntents doesn't touch HttpService — null cast is fine for this scope.
    service = new SwapVerificationService(null as unknown as HttpService)
    jest.restoreAllMocks()
  })

  it('verifies a successful swap with shapeshift referral and appFees', async () => {
    jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(nearResponse as never)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 30,
      affiliateAddress: 'shapeshifttokenomics.sputnik-dao.near',
      verifiedSellAmountCryptoBaseUnit: '1000000000000000',
      actualBuyAmountCryptoBaseUnit: '1969643',
      actualAffiliateFeeAmountCryptoBaseUnit: '3000000000000',
    })
  })

  it('returns undefined affiliate fee amount when there is no shapeshift affiliate', async () => {
    const response = structuredClone(nearResponse)
    response.quoteResponse.quoteRequest.referral = 'someone-else'

    jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(response as never)

    const result = await service.verifySwap(swap)

    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
    expect(result.actualBuyAmountCryptoBaseUnit).toBe('1969643')
  })

  it('returns hasAffiliate=false when referral is not shapeshift', async () => {
    const response = structuredClone(nearResponse)
    response.quoteResponse.quoteRequest.referral = 'someone-else'

    jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(response as never)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
    expect(result.affiliateAddress).toBeUndefined()
  })

  it('returns hasAffiliate=false when referral is shapeshift but no appFees', async () => {
    const response = structuredClone(nearResponse)
    response.quoteResponse.quoteRequest.appFees = []

    jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(response as never)

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
  })

  it('returns hasAffiliate=false when referral is shapeshift but appFees has no shapeshift recipient', async () => {
    // Real-world case: 1Click routes appFees to other partners while still attributing
    // the referral to shapeshift. We should not credit ourselves for another partner's bps.
    const response = structuredClone(nearResponse)
    response.quoteResponse.quoteRequest.appFees = [
      { recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd', fee: 50 },
    ]

    jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(response as never)

    const result = await service.verifySwap(swap)

    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('falls back to quote.amountIn when swapDetails amounts are missing', async () => {
    const response = structuredClone(nearResponse)
    delete (response.swapDetails as Partial<typeof response.swapDetails>).depositedAmount
    delete (response.swapDetails as Partial<typeof response.swapDetails>).amountIn

    jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(response as never)

    const result = await service.verifySwap(swap)

    expect(result.verifiedSellAmountCryptoBaseUnit).toBe(response.quoteResponse.quote.amountIn)
  })

  it('returns FAILED when nearIntentsSpecific.depositAddress is missing', async () => {
    const swapWithoutMetadata = { ...swap, metadata: {} as SwapperSpecificMetadata } as Swap

    const result = await service.verifySwap(swapWithoutMetadata)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing depositAddress in nearIntentsSpecific metadata',
    })
  })

  it('returns PENDING when the SDK throws (transient — retry next tick)', async () => {
    jest.spyOn(OneClickService, 'getExecutionStatus').mockRejectedValue(new Error('upstream 500'))

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('upstream 500')
  })
})
