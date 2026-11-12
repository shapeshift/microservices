import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'

import { failingHttp, mockHttp } from '../../../test-helpers'

import thorchainPartialFillResponse from './thorchain.partialFill.response.json'
import thorchainResponse from './thorchain.response.json'
import thorchainSwap from './thorchain.swap'

const swap = thorchainSwap as unknown as Swap

describe('verifyThorchain', () => {
  let service: SwapVerificationService

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('verifies a successful swap with shapeshift affiliate', async () => {
    service = new SwapVerificationService(mockHttp(thorchainResponse).http)

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
    const { http, get } = mockHttp(thorchainResponse)
    service = new SwapVerificationService(http)

    await service.verifySwap(swap)

    const url = get.mock.calls[0][0]
    expect(url).toMatch(/\/actions\?txid=[0-9a-f]+$/i)
    expect(url).not.toMatch(/=0x/i)
  })

  it('does not attribute affiliate fields when the action affiliate is not ss', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].metadata.swap.affiliateAddress = 'other'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.affiliateBps).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('finds no affiliate when the memo names ss but the protocol paid it nothing', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].out = response.actions[0].out.filter((out) => !out.affiliate)

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Midgard action paid the ShapeShift affiliate nothing',
      verifiedSellAmountCryptoBaseUnit: '3000000000000000',
    })
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('returns FAILED when sellTxHash is missing', async () => {
    service = new SwapVerificationService(mockHttp(thorchainResponse).http)

    const result = await service.verifySwap({ ...swap, sellTxHash: null } as Swap)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Missing sell txHash',
    })
  })

  it('returns PENDING when Midgard returns no actions', async () => {
    service = new SwapVerificationService(mockHttp({ actions: [] }).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('No action found in Midgard')
  })

  it('returns PENDING when the action is still pending', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].status = 'pending'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('Swap action still pending')
  })

  it('returns FAILED when the action type is not swap', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].type = 'addLiquidity'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Invalid swap action type')
  })

  it('returns FAILED when swap metadata is missing', async () => {
    const response = structuredClone(thorchainResponse) as {
      actions: Array<{ metadata: { swap?: unknown } }>
    }
    delete response.actions[0].metadata.swap

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('No swap metadata found')
  })

  it('selects the buy out by memo destination rather than array position', async () => {
    const response = structuredClone(thorchainResponse)
    // Move the destination out to the front so position-based selection would return the wrong entry.
    response.actions[0].out.reverse()

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('6643738')
  })

  it('sums a buy outbound paid from several vaults', async () => {
    const response = structuredClone(thorchainResponse)
    const buyOut = response.actions[0].out.find((out) => !out.affiliate)
    response.actions[0].out.push(structuredClone(buyOut))

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('13287476')
  })

  it('leaves a partial refund to the destination out of the buy amount', async () => {
    const response = structuredClone(thorchainResponse)
    const buyOut = response.actions[0].out.find((out) => !out.affiliate)
    response.actions[0].out.push({ ...buyOut, coins: [{ amount: '100000', asset: 'ETH.ETH' }] })

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('6643738')
  })

  it('matches the memo destination when it carries a refund address', async () => {
    const response = structuredClone(thorchainResponse)
    const { memo } = response.actions[0].metadata.swap
    response.actions[0].metadata.swap.memo = memo.replace(
      '0xA44C286BA83Bb771cd0107B2c1Df678435Bd1535',
      '0xA44C286BA83Bb771cd0107B2c1Df678435Bd1535/0x31b116a71f99cf1f9ac718e5ba06b633e10f118d',
    )

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', actualBuyAmountCryptoBaseUnit: '6643738' })
  })

  it('matches the affiliate name regardless of case', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].metadata.swap.affiliateAddress = 'SS'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({ hasAffiliate: true, affiliateAddress: 'ss' })
  })

  it('returns FAILED when no out matches the memo destination', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].out = response.actions[0].out.map((out) =>
      out.affiliate ? out : { ...out, address: '0xdeadbeef' },
    )

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('No outbound matching memo destination')
  })

  it('returns FAILED when the action status is failed (refund)', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].status = 'failed'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Swap action failed')
  })

  it('returns FAILED when the memo has no destination address', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].metadata.swap.memo = ''

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Could not parse destination address from memo')
  })

  it('takes the swap action of a partially filled streaming swap, not the refund of the unfilled part', async () => {
    const response = structuredClone(thorchainResponse) as { actions: Array<Record<string, unknown>> }
    const [swapAction] = response.actions
    response.actions = [{ ...swapAction, type: 'refund' }, swapAction]

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', actualAffiliateFeeAmountCryptoBaseUnit: '6944500' })
  })

  it('takes only the filled part of a real partially filled streaming swap', async () => {
    // mainnet A4E275F0…7374: 2 ETH deposited, 0.88484868 swapped to ZEC, 1.11515132 refunded
    const partialFillSwap = {
      ...swap,
      sellTxHash: '0xa4e275f02a68a79305cc5dbb9641ae52b97bd1cf2b3b7ef62bdba4f341637374',
      buyAsset: {
        ...swap.buyAsset,
        symbol: 'ZEC',
        assetId: 'bip122:00040fe8ec8471911baa1db1266ea15d/slip44:133',
        precision: 8,
      },
      affiliateBps: 1,
      shapeshiftBps: 1,
      partnerBps: 0,
    } as Swap

    service = new SwapVerificationService(mockHttp(thorchainPartialFillResponse).http)

    const result = await service.verifySwap(partialFillSwap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 1,
      verifiedSellAmountCryptoBaseUnit: '884848680000000000',
      actualBuyAmountCryptoBaseUnit: '161089489',
      actualAffiliateFeeAmountCryptoBaseUnit: '33229704',
    })
  })

  it('returns FAILED when the sell tx was only refunded', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].type = 'refund'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({ verificationStatus: 'FAILED', noAffiliateReason: 'Invalid swap action type' })
  })

  it('ignores an action whose inbound is not the sell tx', async () => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].in[0].txID = '1'.repeat(64)

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'No action found in Midgard' })
  })

  it.each([
    ['above', '80'],
    ['below', '11'],
  ])('stays PENDING when the memo affiliate fee is %s what the swap charged', async (_, fee) => {
    const response = structuredClone(thorchainResponse)
    response.actions[0].metadata.swap.affiliateFee = fee

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: `THORChain affiliate fee of ${fee} bps differs from the swap's 60 bps`,
    })
  })

  it('finds no affiliate when the affiliate payout is not in RUNE', async () => {
    const response = structuredClone(thorchainResponse)
    const affiliateOut = response.actions[0].out.find((out) => out.affiliate)
    affiliateOut.coins[0].asset = 'ETH.ETH'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Midgard action paid the ShapeShift affiliate nothing',
      verifiedSellAmountCryptoBaseUnit: '3000000000000000',
    })
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('finds no affiliate when the affiliate payout is zero', async () => {
    const response = structuredClone(thorchainResponse)
    const affiliateOut = response.actions[0].out.find((out) => out.affiliate)
    affiliateOut.coins[0].amount = '0'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Midgard action paid the ShapeShift affiliate nothing',
      verifiedSellAmountCryptoBaseUnit: '3000000000000000',
    })
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('returns PENDING when the HTTP call fails (transient — retry next tick)', async () => {
    service = new SwapVerificationService(failingHttp())

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('upstream 500')
  })
})
