import { Logger } from '@nestjs/common'

import { mayachainAssetId } from '@shapeshiftoss/caip'

import type { Swap } from '../types'
import { calculateFeeForSwap } from '../utils'

// Minimal swap shape exercising calculateFeeForSwap's fee/volume math. CACAO fee asset so a stored
// '0' fee amount resolves to actualFeeUsd = 0 (the real 0-bps case this branch introduced).
const makeSwap = (overrides: Partial<Swap> = {}): Swap =>
  ({
    swapId: 'test-swap',
    sellAsset: { assetId: 'eip155:1/slip44:60', precision: 18 },
    buyAsset: { assetId: 'eip155:1/erc20:0xusdc', precision: 6 },
    sellAssetUsd: '2000',
    buyAssetUsd: '1',
    affiliateAssetUsd: '0.1',
    affiliateFeeAssetId: mayachainAssetId,
    actualAffiliateFeeAmountCryptoBaseUnit: '0',
    actualBuyAmountCryptoBaseUnit: '5000000', // 5 USDC
    expectedBuyAmountCryptoBaseUnit: '5000000',
    affiliateVerificationDetails: {
      hasAffiliate: true,
      affiliateBps: 0,
      verifiedSellAmountCryptoBaseUnit: '1000000000000000', // 0.001 ETH
    },
    ...overrides,
  }) as unknown as Swap

describe('calculateFeeForSwap volume reconstruction', () => {
  afterEach(() => jest.restoreAllMocks())

  it('uses the sell-side USD as volume for a 0-bps swap when the sell price is present', () => {
    const result = calculateFeeForSwap(makeSwap())

    expect(result).not.toBeNull()
    expect(result?.feeUsd).toBe(0)
    // 0.001 ETH * $2000
    expect(result?.volumeUsd).toBe(2)
  })

  it('records volume 0 (not NaN/Infinity) and warns for a 0-bps swap when the sell price is missing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const result = calculateFeeForSwap(makeSwap({ sellAssetUsd: null }))

    expect(result).not.toBeNull()
    expect(result?.feeUsd).toBe(0)
    expect(result?.volumeUsd).toBe(0)
    expect(Number.isFinite(result?.volumeUsd)).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('volume unknown'))
  })

  it('still reconstructs volume from the fee at >0 bps when the sell price is missing', () => {
    const result = calculateFeeForSwap(
      makeSwap({
        sellAssetUsd: null,
        // 1e11 CACAO base units / 1e10 * $0.1 = $1 actual fee
        actualAffiliateFeeAmountCryptoBaseUnit: '100000000000',
        affiliateVerificationDetails: {
          hasAffiliate: true,
          affiliateBps: 100, // 1%
          verifiedSellAmountCryptoBaseUnit: '1000000000000000',
        },
      }),
    )

    expect(result).not.toBeNull()
    expect(result?.feeUsd).toBe(1)
    // fee $1 / 1% = $100 volume
    expect(result?.volumeUsd).toBe(100)
  })
})
