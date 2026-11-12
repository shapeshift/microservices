import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'
import { failingHttp, mockHttp } from '../../../test-helpers'

import mayachainResponse from './mayachain.response.json'
import mayachainSwap from './mayachain.swap'

const swap = mayachainSwap as unknown as Swap

describe('verifyMayachain', () => {
  let service: SwapVerificationService

  it('verifies a successful swap with shapeshift affiliate', async () => {
    service = new SwapVerificationService(mockHttp(mayachainResponse).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: 'ssmaya',
      verifiedSellAmountCryptoBaseUnit: '4000000000000000',
      actualBuyAmountCryptoBaseUnit: '7340228',
      // Midgard reports CACAO in native 1e10 precision, so the raw affiliate out amount is used as-is.
      actualAffiliateFeeAmountCryptoBaseUnit: '4237779000',
    })
  })

  // Midgard normalizes every coin to 1e8 — except MAYAChain's native CACAO, which it reports at its
  // native 1e10. Amounts from these two cases are taken verbatim from mainnet actions
  // 8F9B6692…30D (CACAO -> ETH.USDT) and DA174E41…A57 (BTC.BTC -> CACAO).
  const cacaoAsset = {
    symbol: 'CACAO',
    assetId: 'cosmos:mayachain-mainnet-v1/slip44:931',
    chainId: 'cosmos:mayachain-mainnet-v1',
    precision: 10,
  }

  it('does not shift the sell amount when the sell leg is native CACAO', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].in[0].coins[0] = { amount: '241570000000000', asset: 'MAYA.CACAO' }

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap({ ...swap, sellAsset: cacaoAsset } as Swap)

    expect(result.verifiedSellAmountCryptoBaseUnit).toBe('241570000000000')
  })

  it('does not shift the buy amount when the buy leg is native CACAO', async () => {
    const response = structuredClone(mayachainResponse)
    const buyOut = response.actions[0].out.find((out) => !('affiliate' in out && out.affiliate))
    buyOut.coins[0] = { amount: '84513804751580', asset: 'MAYA.CACAO' }

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap({ ...swap, buyAsset: cacaoAsset } as Swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('84513804751580')
  })

  it('strips 0x prefix from sellTxHash before calling Midgard', async () => {
    const { http, get } = mockHttp(mayachainResponse)
    service = new SwapVerificationService(http)

    await service.verifySwap(swap)

    const url = get.mock.calls[0][0]
    expect(url).toMatch(/\/actions\?txid=[0-9a-f]+$/i)
    expect(url).not.toMatch(/=0x/i)
  })

  it('does not attribute affiliate fields when the action affiliate is not ssmaya', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].metadata.swap.affiliateAddress = 'other'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('SUCCESS')
    expect(result.hasAffiliate).toBe(false)
    expect(result.noAffiliateReason).toBe('Midgard memo names no ShapeShift affiliate')
    expect(result.affiliateAddress).toBeUndefined()
    expect(result.affiliateBps).toBeUndefined()
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('finds no affiliate when the memo names ssmaya but the protocol paid it nothing', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].out = response.actions[0].out.filter((out) => !('affiliate' in out && out.affiliate))

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Midgard action paid the ShapeShift affiliate nothing',
      verifiedSellAmountCryptoBaseUnit: '4000000000000000',
    })
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('returns FAILED when sellTxHash is missing', async () => {
    service = new SwapVerificationService(mockHttp(mayachainResponse).http)

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
    const response = structuredClone(mayachainResponse)
    response.actions[0].status = 'pending'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('Swap action still pending')
  })

  it('returns FAILED when the action type is not swap', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].type = 'addLiquidity'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Invalid swap action type')
  })

  it('returns FAILED when swap metadata is missing', async () => {
    const response = structuredClone(mayachainResponse) as {
      actions: Array<{ metadata: { swap?: unknown } }>
    }
    delete response.actions[0].metadata.swap

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('No swap metadata found')
  })

  it('selects the buy out by memo destination rather than array position', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].out.reverse()

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.actualBuyAmountCryptoBaseUnit).toBe('7340228')
  })

  it('returns FAILED when no out matches the memo destination', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].out = response.actions[0].out.map((out) =>
      'affiliate' in out && out.affiliate ? out : { ...out, address: '0xdeadbeef' },
    )

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('No outbound matching memo destination')
  })

  it('returns FAILED when the action status is failed (refund)', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].status = 'failed'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Swap action failed')
  })

  it('returns FAILED when the memo has no destination address', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].metadata.swap.memo = ''

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('FAILED')
    expect(result.noAffiliateReason).toBe('Could not parse destination address from memo')
  })

  it('stays PENDING when the memo affiliate fee differs from what the swap charged', async () => {
    const response = structuredClone(mayachainResponse)
    response.actions[0].metadata.swap.affiliateFee = '40'

    service = new SwapVerificationService(mockHttp(response).http)

    const result = await service.verifySwap(swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', hasAffiliate: false })
  })

  it('returns PENDING when the HTTP call fails (transient — retry next tick)', async () => {
    service = new SwapVerificationService(failingHttp())

    const result = await service.verifySwap(swap)

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toBe('upstream 500')
  })
})
