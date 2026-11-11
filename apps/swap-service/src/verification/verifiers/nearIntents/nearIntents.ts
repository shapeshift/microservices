import { GetExecutionStatusResponse, OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript'
import { firstValueFrom } from 'rxjs'

import { env } from '../../../env'
import type { Verifier, VerifierDeps } from '../../types'
import { getSwapMetadata, noAffiliateResult } from '../../utils'

const REFERRAL = 'shapeshift'
const TREASURY = 'shapeshifttokenomics.sputnik-dao.near'
const INTENTS_CONTRACT = 'intents.near'
const EVENT_PREFIX = 'EVENT_JSON:'

OpenAPI.BASE = 'https://1click.chaindefuser.com'
OpenAPI.TOKEN = env.VITE_NEAR_INTENTS_API_KEY

type MtEvent = {
  owner_id?: string
  old_owner_id?: string
  new_owner_id?: string
  token_ids: string[]
  amounts: string[]
  memo?: string
}

type IntentsEvent = {
  standard: string
  event: string
  data: MtEvent[]
}

// EXPERIMENTAL_tx_status, trimmed to the fields verification reads
type TxStatusResponse = {
  result?: {
    receipts_outcome: Array<{ outcome: { executor_id: string; logs: string[] } }>
  }
}

const fetchIntentsEvents = async (txHash: string, { http }: VerifierDeps): Promise<IntentsEvent[]> => {
  const { data } = await firstValueFrom(
    http.post<TxStatusResponse>(env.VITE_NEAR_ARCHIVAL_NODE_URL, {
      jsonrpc: '2.0',
      id: 'verification',
      method: 'EXPERIMENTAL_tx_status',
      params: { tx_hash: txHash, sender_account_id: INTENTS_CONTRACT, wait_until: 'NONE' },
    }),
  )

  if (!data.result) throw new Error(`NEAR transaction ${txHash} not found`)

  return data.result.receipts_outcome
    .filter(({ outcome }) => outcome.executor_id === INTENTS_CONTRACT)
    .flatMap(({ outcome }) => outcome.logs)
    .filter((log) => log.startsWith(EVENT_PREFIX))
    .map((log) => JSON.parse(log.slice(EVENT_PREFIX.length)) as IntentsEvent)
}

const sumToken = (events: MtEvent[], token: string): bigint =>
  events.reduce(
    (sum, { token_ids, amounts }) =>
      token_ids.reduce((acc, id, i) => (id === token ? acc + BigInt(amounts[i]) : acc), sum),
    0n,
  )

// what the treasury actually received on the intents ledger, scoped to this swap's own deposit account
const fetchTreasuryFee = async (txHashes: string[], token: string, deps: VerifierDeps): Promise<bigint | undefined> => {
  const events = (await Promise.all(txHashes.map((txHash) => fetchIntentsEvents(txHash, deps)))).flat()
  const mtEvents = (name: string) =>
    events.filter(({ standard, event }) => standard === 'nep245' && event === name).flatMap(({ data }) => data)

  // the deposit is minted to a per-swap account, which is what pays the app fee out
  const swapAccount = mtEvents('mt_mint').find(
    ({ memo, token_ids }) => memo === 'deposit' && token_ids.includes(token),
  )?.owner_id
  if (!swapAccount) return

  const feeTransfers = mtEvents('mt_transfer').filter(
    ({ old_owner_id, new_owner_id }) => old_owner_id === swapAccount && new_owner_id === TREASURY,
  )

  return sumToken(feeTransfers, token)
}

export const verifyNearIntents: Verifier = async (swap, deps) => {
  const nearIntents = getSwapMetadata(swap.metadata, 'nearIntents')
  if (!nearIntents?.depositAddress) return noAffiliateResult('FAILED', 'Missing depositAddress in nearIntents metadata')

  const { status, quoteResponse, swapDetails } = await OneClickService.getExecutionStatus(
    nearIntents.depositAddress,
    nearIntents.depositMemo,
  )

  switch (status) {
    case GetExecutionStatusResponse.status.SUCCESS:
      break
    case GetExecutionStatusResponse.status.REFUNDED:
    case GetExecutionStatusResponse.status.FAILED:
      return noAffiliateResult('FAILED', `1Click swap ${status.toLowerCase()}`)
    default:
      return noAffiliateResult('PENDING', `1Click swap ${status.toLowerCase()}`)
  }

  const { referral, appFees = [], originAsset } = quoteResponse.quoteRequest

  // the executed input, which excludes any over-deposit 1Click refunded
  const verifiedSellAmountCryptoBaseUnit = swapDetails.amountIn
  if (!verifiedSellAmountCryptoBaseUnit) return noAffiliateResult('PENDING', 'Missing executed amountIn from 1Click')

  const amounts = { verifiedSellAmountCryptoBaseUnit, actualBuyAmountCryptoBaseUnit: swapDetails.amountOut }

  // 1Click reports the treasury's share after taking its own cut of the requested fee
  const appFee =
    referral?.toLowerCase() === REFERRAL ? appFees.find(({ recipient }) => recipient === TREASURY) : undefined
  if (!appFee) return { ...noAffiliateResult('SUCCESS', 'No ShapeShift app fee on the 1Click quote'), ...amounts }

  const feeAmount = await fetchTreasuryFee(swapDetails.nearTxHashes, originAsset, deps)
  if (feeAmount === undefined) return noAffiliateResult('PENDING', 'Deposit not found in the NEAR transactions')

  // 1Click reported the fee but it never reached the treasury, so there's no revenue to attribute
  if (feeAmount === 0n) {
    return { ...noAffiliateResult('SUCCESS', 'App fee never reached the treasury on chain'), ...amounts }
  }

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: true,
    affiliateBps: appFee.fee,
    affiliateAddress: TREASURY,
    ...amounts,
    actualAffiliateFeeAmountCryptoBaseUnit: feeAmount.toString(),
  }
}
