import { GetExecutionStatusResponse, OneClickService } from '@defuse-protocol/one-click-sdk-typescript'

import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'
import { failingHttp } from '../../../test-helpers'
import { TREASURY_ACCOUNTS } from '../nearIntents'

import exactInputResponse from './nearIntents.exactInput.response.json'
import exactInputSwap from './nearIntents.exactInput.swap'
import exactOutputResponse from './nearIntents.exactOutput.response.json'
import exactOutputSwap from './nearIntents.exactOutput.swap'

const [TREASURY] = TREASURY_ACCOUNTS
// 1Click's own half of the requested app fee
const ONE_CLICK_FEE_RECIPIENT = '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd'

const verify = async (swap: unknown, statusResponse: unknown) => {
  const getExecutionStatus = jest
    .spyOn(OneClickService, 'getExecutionStatus')
    .mockResolvedValue(statusResponse as never)
  const result = await new SwapVerificationService(failingHttp()).verifySwap(swap as Swap)
  return { result, getExecutionStatus }
}

const withQuoteRequest = (
  update: Partial<(typeof exactInputResponse)['quoteResponse']['quoteRequest']>,
): typeof exactInputResponse => {
  const statusResponse = structuredClone(exactInputResponse)
  Object.assign(statusResponse.quoteResponse.quoteRequest, update)
  return statusResponse
}

describe('verifyNearIntents', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('derives the fee from the executed input of an EXACT_INPUT swap', async () => {
    const { result } = await verify(exactInputSwap, exactInputResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 40,
      affiliateAddress: TREASURY,
      verifiedSellAmountCryptoBaseUnit: '31000000',
      actualBuyAmountCryptoBaseUnit: '1232523675089583993',
      // 31000000 × 40 / 10000, which is what the treasury received on chain
      actualAffiliateFeeAmountCryptoBaseUnit: '124000',
    })
  })

  it('derives the fee from the executed input of an EXACT_OUTPUT swap, not the over-deposit', async () => {
    const { result } = await verify(exactOutputSwap, exactOutputResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 40,
      affiliateAddress: TREASURY,
      // the executed input, not the over-deposited 8367915739941227 (40320563547722 was refunded)
      verifiedSellAmountCryptoBaseUnit: '8327035176393505',
      actualBuyAmountCryptoBaseUnit: exactOutputResponse.swapDetails.amountOut,
      // amountIn × 40 / 10000 rounded up, which is what the treasury received in FZR7HPZ6aB3z7SwjdpytyeXuDYoCwYf2Yo3LNspdxojr
      actualAffiliateFeeAmountCryptoBaseUnit: '33308140705575',
    })
  })

  it.each([
    ['above', 80],
    ['below', 20],
  ])('stays PENDING when 1Click reports a treasury share %s the bps the swap charged', async (_, fee) => {
    const appFees = exactInputResponse.quoteResponse.quoteRequest.appFees.map((appFee) =>
      appFee.recipient === TREASURY ? { ...appFee, fee } : appFee,
    )

    const { result } = await verify(exactInputSwap, withQuoteRequest({ appFees }))

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: `NEAR Intents affiliate fee of ${fee} bps differs from the swap's 40 bps`,
    })
  })

  it('credits a treasury app fee whatever the referral', async () => {
    const { result } = await verify(exactInputSwap, withQuoteRequest({ referral: 'someone-else' }))

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      actualAffiliateFeeAmountCryptoBaseUnit: '124000',
    })
  })

  it('sums every treasury app fee on the quote', async () => {
    const appFees = exactInputResponse.quoteResponse.quoteRequest.appFees.flatMap((appFee) =>
      appFee.recipient === TREASURY
        ? [
            { ...appFee, fee: 30 },
            { ...appFee, fee: 10 },
          ]
        : [appFee],
    )

    const { result } = await verify(exactInputSwap, withQuoteRequest({ appFees }))

    // 30 + 10 bps of 31000000, the same as the single 40 bps fee
    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      affiliateBps: 40,
      actualAffiliateFeeAmountCryptoBaseUnit: '124000',
    })
  })

  it("finds no affiliate when only 1Click's own app fee is on the quote", async () => {
    const appFees = exactInputResponse.quoteResponse.quoteRequest.appFees.filter(
      ({ recipient }) => recipient === ONE_CLICK_FEE_RECIPIENT,
    )

    const { result } = await verify(exactInputSwap, withQuoteRequest({ appFees }))

    expect(result).toMatchObject({ verificationStatus: 'SUCCESS', hasAffiliate: false })
    expect(result.affiliateBps).toBeUndefined()
  })

  it('finds no affiliate when the treasury app fee on the quote is 0 bps', async () => {
    const appFees = exactInputResponse.quoteResponse.quoteRequest.appFees.map((appFee) =>
      appFee.recipient === TREASURY ? { ...appFee, fee: 0 } : appFee,
    )

    const { result } = await verify(exactInputSwap, withQuoteRequest({ appFees }))

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: '1Click charged a 0 ShapeShift app fee',
      verifiedSellAmountCryptoBaseUnit: '31000000',
    })
    expect(result.actualAffiliateFeeAmountCryptoBaseUnit).toBeUndefined()
  })

  it('stays PENDING when 1Click has no executed amountIn', async () => {
    const statusResponse = structuredClone(exactInputResponse)
    Object.assign(statusResponse.swapDetails, { amountIn: undefined })

    const { result } = await verify(exactInputSwap, statusResponse)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', hasAffiliate: false })
  })

  it.each([
    [GetExecutionStatusResponse.status.REFUNDED, 'FAILED'],
    [GetExecutionStatusResponse.status.FAILED, 'FAILED'],
    [GetExecutionStatusResponse.status.KNOWN_DEPOSIT_TX, 'PENDING'],
    [GetExecutionStatusResponse.status.PENDING_DEPOSIT, 'PENDING'],
    [GetExecutionStatusResponse.status.INCOMPLETE_DEPOSIT, 'PENDING'],
    [GetExecutionStatusResponse.status.PROCESSING, 'PENDING'],
  ])('maps a %s 1Click swap to %s', async (status, verificationStatus) => {
    const { result } = await verify(exactInputSwap, { ...exactInputResponse, status })

    expect(result).toMatchObject({ verificationStatus, hasAffiliate: false })
  })

  it('looks the swap up by its deposit memo when it has one', async () => {
    const swap = structuredClone(exactInputSwap)
    Object.assign(swap.metadata.swapperMetadata, { depositMemo: '12345' })

    const { getExecutionStatus } = await verify(swap, exactInputResponse)

    expect(getExecutionStatus).toHaveBeenCalledWith('0x90416AD824C7e31050eD9F46587c8bE24a72b7E3', '12345')
  })

  it('returns FAILED when nearIntents metadata is missing', async () => {
    const { result } = await verify({ ...exactInputSwap, metadata: {} as SwapMetadata }, exactInputResponse)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      noAffiliateReason: 'Missing depositAddress in nearIntents metadata',
    })
  })

  it('cancels a 1Click status request that hangs and stays PENDING', async () => {
    jest.useFakeTimers()

    let reject: (error: Error) => void = () => undefined
    const hung = new Promise((_, r) => (reject = r))
    const cancel = jest.fn(() => reject(new Error('Request aborted')))
    jest.spyOn(OneClickService, 'getExecutionStatus').mockReturnValue(Object.assign(hung, { cancel }) as never)

    const pending = new SwapVerificationService(failingHttp()).verifySwap(exactInputSwap as Swap)
    await jest.advanceTimersByTimeAsync(15_000)

    expect(cancel).toHaveBeenCalled()
    expect(await pending).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'Request aborted' })

    jest.useRealTimers()
  })

  it('returns PENDING when 1Click errors (transient, retried next tick)', async () => {
    jest.spyOn(OneClickService, 'getExecutionStatus').mockRejectedValue(new Error('upstream 500'))

    const result = await new SwapVerificationService(failingHttp()).verifySwap(exactInputSwap as Swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'upstream 500' })
  })
})
