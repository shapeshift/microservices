import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript'
import type { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'

import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'

import paidResponse from './nearIntents.paid.response.json'
import paidSwap from './nearIntents.paid.swap'
import paidTxs from './nearIntents.paid.txs.json'
import unpaidResponse from './nearIntents.unpaid.response.json'
import unpaidSwap from './nearIntents.unpaid.swap'
import unpaidTxs from './nearIntents.unpaid.txs.json'

const TREASURY = 'shapeshifttokenomics.sputnik-dao.near'

type Txs = Record<
  string,
  { result?: { receipts_outcome: Array<{ outcome: { executor_id: string; logs: string[] } }> } }
>

const mockRpc = (txs: Txs) => {
  const post = jest.fn((_url: string, body: { params: { tx_hash: string } }) =>
    of({ data: txs[body.params.tx_hash] ?? {} }),
  )
  return { http: { post } as unknown as HttpService, post }
}

const verify = async (swap: unknown, response: unknown, txs: Txs = paidTxs) => {
  const getExecutionStatus = jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue(response as never)
  const { http, post } = mockRpc(txs)
  const result = await new SwapVerificationService(http).verifySwap(swap as Swap)
  return { result, post, getExecutionStatus }
}

// rewrites every event log in the fixture transactions
const mapLogs = (txs: Txs, fn: (log: string) => string): Txs => {
  const copy = structuredClone(txs)
  for (const tx of Object.values(copy)) {
    for (const receipt of tx.result?.receipts_outcome ?? []) receipt.outcome.logs = receipt.outcome.logs.map(fn)
  }
  return copy
}

describe('verifyNearIntents', () => {
  beforeEach(() => jest.restoreAllMocks())

  it('reads the fee the treasury received on chain, not the deposit-based estimate', async () => {
    const { result } = await verify(paidSwap, paidResponse)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 40,
      affiliateAddress: TREASURY,
      // the executed input, not the over-deposited 8367915739941227 (40320563547722 was refunded)
      verifiedSellAmountCryptoBaseUnit: '8327035176393505',
      actualBuyAmountCryptoBaseUnit: paidResponse.swapDetails.amountOut,
      // the mt_transfer to the treasury, which 1Click rounds up from amountIn × 40 / 10000
      actualAffiliateFeeAmountCryptoBaseUnit: '33308140705575',
    })
  })

  it('finds no affiliate when 1Click reports the app fee but the treasury never received it', async () => {
    const { result } = await verify(unpaidSwap, unpaidResponse, unpaidTxs)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'App fee never reached the treasury on chain',
      verifiedSellAmountCryptoBaseUnit: '299900000',
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    })
  })

  it('ignores treasury transfers paid out by another swap settled in the same transaction', async () => {
    const swapAccount = '21d1b25834536367e5c197b5f8d8ad8611a6c1dd3ecf2dcc6d70f261a9ef777d'
    const txs = mapLogs(paidTxs, (log) =>
      log.includes('mt_transfer')
        ? log.split(`"old_owner_id":"${swapAccount}"`).join('"old_owner_id":"other.near"')
        : log,
    )

    const { result } = await verify(paidSwap, paidResponse, txs)

    expect(result.hasAffiliate).toBe(false)
    expect(result.noAffiliateReason).toBe('App fee never reached the treasury on chain')
  })

  it('stays PENDING when the deposit is not among the transactions 1Click lists', async () => {
    const txs = mapLogs(paidTxs, (log) => log.replace('"event":"mt_mint"', '"event":"mt_other"'))

    const { result } = await verify(paidSwap, paidResponse, txs)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', hasAffiliate: false })
  })

  it('stays PENDING when a NEAR transaction cannot be fetched', async () => {
    const { result } = await verify(paidSwap, paidResponse, {})

    expect(result.verificationStatus).toBe('PENDING')
    expect(result.noAffiliateReason).toMatch(/NEAR transaction .* not found/)
  })

  it('finds no affiliate, without reading the chain, when the referral is not shapeshift', async () => {
    const response = structuredClone(paidResponse)
    response.quoteResponse.quoteRequest.referral = 'someone-else'

    const { result, post } = await verify(paidSwap, response)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      verifiedSellAmountCryptoBaseUnit: '8327035176393505',
    })
    expect(post).not.toHaveBeenCalled()
  })

  it('does not credit another partner app fee to the treasury', async () => {
    const response = structuredClone(paidResponse)
    response.quoteResponse.quoteRequest.appFees = response.quoteResponse.quoteRequest.appFees.filter(
      ({ recipient }) => recipient !== TREASURY,
    )

    const { result } = await verify(paidSwap, response)

    expect(result.hasAffiliate).toBe(false)
    expect(result.affiliateBps).toBeUndefined()
  })

  it.each([
    ['REFUNDED', 'FAILED'],
    ['FAILED', 'FAILED'],
    ['PROCESSING', 'PENDING'],
    ['PENDING_DEPOSIT', 'PENDING'],
    ['INCOMPLETE_DEPOSIT', 'PENDING'],
  ])('maps a %s 1Click swap to %s', async (status, verificationStatus) => {
    const { result, post } = await verify(paidSwap, { ...paidResponse, status })

    expect(result).toMatchObject({ verificationStatus, hasAffiliate: false })
    expect(post).not.toHaveBeenCalled()
  })

  it('looks the swap up by its deposit memo when it has one', async () => {
    const swap = structuredClone(paidSwap)
    Object.assign(swap.metadata.swapperMetadata, { depositMemo: '12345' })

    const { getExecutionStatus } = await verify(swap, paidResponse)

    expect(getExecutionStatus).toHaveBeenCalledWith('0xDDa84fEfcC2524788CAfA4B43c16Eff6d5610587', '12345')
  })

  it('returns FAILED when nearIntents metadata is missing', async () => {
    const { result } = await verify({ ...paidSwap, metadata: {} as SwapMetadata }, paidResponse)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      noAffiliateReason: 'Missing depositAddress in nearIntents metadata',
    })
  })

  it('returns PENDING when 1Click errors (transient, retried next tick)', async () => {
    jest.spyOn(OneClickService, 'getExecutionStatus').mockRejectedValue(new Error('upstream 500'))

    const result = await new SwapVerificationService(mockRpc(paidTxs).http).verifySwap(paidSwap as Swap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'upstream 500' })
  })
})
