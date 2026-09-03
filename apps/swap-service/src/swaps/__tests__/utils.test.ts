import { Logger } from '@nestjs/common'

import { mayachainAssetId } from '@shapeshiftoss/caip'

import type { Swap } from '../types'
import { calculateFeeForSwap, describeError, resolveQuoteBinding, resolveStalledSwap } from '../utils'

// Minimal swap shape exercising calculateFeeForSwap's fee/volume math. CACAO fee asset so a stored
// '0' fee amount resolves to actualFeeUsd = 0 (the real 0-bps case this branch introduced).
const makeSwap = (overrides: Partial<Swap> = {}): Swap =>
  ({
    swapId: 'test-swap',
    isAffiliateVerified: true,
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

  it('returns null without warning for a swap that is not affiliate-verified', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    // e.g. a failed / unverified swap surfaced by the partner swaps listing
    expect(calculateFeeForSwap(makeSwap({ isAffiliateVerified: false, affiliateVerificationDetails: null }))).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

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

describe('describeError', () => {
  // Shaped like a real AxiosError: isAxiosError is the flag axios.isAxiosError checks.
  const axiosError = (status: number | undefined, data?: unknown, message = 'Request failed with status code 500') =>
    Object.assign(new Error(message), {
      isAxiosError: true,
      response: status === undefined ? undefined : { status, data },
    })

  it('prefers the message the server sent over the generic axios message', () => {
    expect(describeError(axiosError(404, { message: 'tx not found' }))).toBe('tx not found')
  })

  it('reads an error key when the body has no message', () => {
    expect(describeError(axiosError(429, { error: 'rate limited' }))).toBe('rate limited')
  })

  it('serialises a message or error that is not a string', () => {
    expect(describeError(axiosError(400, { error: { message: 'nested' } }))).toBe('{"message":"nested"}')
  })

  it('falls back when the body has neither key', () => {
    const reason = describeError(
      axiosError(400, { errors: { amount: ['too small'] } }, 'Request failed with status code 400'),
    )

    expect(reason).toBe('Request failed with status code 400')
  })

  it('ignores a string body so an error page never reaches the log', () => {
    const reason = describeError(axiosError(403, '<html>'.padEnd(5000, 'x'), 'Request failed with status code 403'))

    expect(reason).toBe('Request failed with status code 403')
  })

  it('falls back to the message for an axios error that never got a response', () => {
    expect(describeError(axiosError(undefined, undefined, 'connect ETIMEDOUT'))).toBe('connect ETIMEDOUT')
  })

  it('returns the message for a plain error', () => {
    expect(describeError(new Error('Non-JSON response: HTTP 403 Forbidden'))).toBe(
      'Non-JSON response: HTTP 403 Forbidden',
    )
  })

  it('handles a thrown string', () => {
    expect(describeError('boom')).toBe('boom')
  })

  it('does not stringify a thrown object as [object Object]', () => {
    expect(describeError({ nope: true })).toBe('Unknown error')
  })
})

describe('resolveStalledSwap', () => {
  const justNow = new Date(Date.now() - 60_000)
  const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)

  it('fails a swap the swapper still cannot settle past the timeout', () => {
    expect(resolveStalledSwap('PENDING', longAgo, 'waiting')).toEqual({
      status: 'FAILED',
      statusMessage: 'Abandoned: unsettled 24h after registration (last swapper status: waiting)',
    })
  })

  // an unmined source tx leaves the swapper with nothing to report
  it('records why it failed when the swapper reported no status', () => {
    expect(resolveStalledSwap('PENDING', longAgo, '').statusMessage).toBe(
      'Abandoned: unsettled 24h after registration (last swapper status: none reported)',
    )
  })

  it('leaves a swap pending inside the timeout', () => {
    expect(resolveStalledSwap('PENDING', justNow, 'waiting')).toEqual({
      status: 'PENDING',
      statusMessage: 'waiting',
    })
  })

  it('never overrides a terminal status, however old the swap', () => {
    expect(resolveStalledSwap('SUCCESS', longAgo, 'complete').status).toBe('SUCCESS')
    expect(resolveStalledSwap('FAILED', longAgo, 'reverted').status).toBe('FAILED')
  })
})

describe('resolveQuoteBinding', () => {
  const blockTime = Date.UTC(2026, 8, 1, 12, 0, 0)
  const found = { blockTime: blockTime / 1000 } as const
  const at = (offsetMs: number) => new Date(blockTime + offsetMs)

  it('accepts a quote minted before its transaction was mined', () => {
    const { status, details } = resolveQuoteBinding(found, at(-60_000))

    expect(status).toBe('ACCEPTED')
    expect(details).toMatchObject({ checked: true, reason: 'quote-precedes-tx', blockTime })
  })

  // the harvest attack: the txid cannot be known until it exists, so the claim's quote is younger
  it('rejects a quote minted after its transaction was mined', () => {
    const { status, details } = resolveQuoteBinding(found, at(1000))

    expect(status).toBe('REJECTED')
    expect(details).toMatchObject({ checked: true, reason: 'quote-postdates-tx' })
  })

  it('accepts a quote minted in the same instant as its block', () => {
    expect(resolveQuoteBinding(found, at(0)).status).toBe('ACCEPTED')
  })

  // absence of evidence is never evidence - none of these may reject
  it.each([
    ['unsupported chain', { unavailable: 'unsupported' } as const, 'unsupported'],
    ['a transaction it cannot see', { unavailable: 'not-found' } as const, 'not-found'],
    ['a failed lookup', { unavailable: 'error' } as const, 'error'],
  ])('holds on %s rather than deciding', (_label, lookup, reason) => {
    const { status, details } = resolveQuoteBinding(lookup, at(-60_000))

    expect(status).toBe('PENDING')
    expect(details).toMatchObject({ checked: false, reason })
  })

  it('holds a row with no quote time, which cannot be checked at all', () => {
    expect(resolveQuoteBinding(found, null)).toMatchObject({
      status: 'PENDING',
      details: { checked: false, reason: 'no-quoted-at' },
    })
  })
})
