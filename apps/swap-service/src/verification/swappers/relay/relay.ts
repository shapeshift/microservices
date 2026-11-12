import { firstValueFrom } from 'rxjs'

import { relayTokenToAssetId } from '@shapeshiftoss/swapper'

import { env } from '../../../env'
import type { Swap } from '../../../swaps/types'
import { getAssetPriceUsdAt } from '../../../utils/pricing'
import type { Verifier, VerifierDeps } from '../../types'
import { getSwapMetadata, noAffiliateResult } from '../../utils'

const REFERRER = 'shapeshift'
// every treasury account app fees have been paid to (lowercase); keep retired ones so older swaps still verify
export const TREASURY_ACCOUNTS = ['0x9c9aa90363630d4ab1d9dbf416cc3bbc8d3ed502']

type RelayToken = {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
}

type RelayAppFee = {
  recipient?: string
  bps?: string
  amount?: string
}

type RelayRouteLeg = {
  inputCurrency?: { currency?: RelayToken; amount?: string }
  outputCurrency?: { currency?: RelayToken; amount?: string }
}

// GET /requests/v3, trimmed to the fields verification reads
type RelayRequest = {
  id?: string
  status?: string
  data?: {
    inTxs?: Array<{ txHash?: string }>
    // authenticated data: only returned for requests created with our API key
    referrer?: string | null
    appFees?: {
      quoted?: RelayAppFee[]
      actual?: RelayAppFee[]
      currency?: RelayToken
    }
    route?: {
      actual?: {
        origin?: RelayRouteLeg
        destination?: RelayRouteLeg | null
      }
    }
  }
}

type RelayRequestsResponse = {
  requests?: RelayRequest[]
}

// matches the id ourselves rather than trusting the listing to have filtered on it
const fetchRelayRequest = async (relayId: string, { http }: VerifierDeps): Promise<RelayRequest | undefined> => {
  const { data } = await firstValueFrom(
    http.get<RelayRequestsResponse>(
      `${env.VITE_RELAY_API_URL}/requests/v3?id=${relayId}&includeAuthenticatedData=true`,
      {
        headers: { 'x-api-key': env.VITE_RELAY_API_KEY },
      },
    ),
  )

  const id = relayId.toLowerCase()

  return data?.requests?.find((request) => request.id?.toLowerCase() === id)
}

const toAssetId = (token: RelayToken): string | undefined => {
  try {
    return relayTokenToAssetId(token)
  } catch {
    return
  }
}

const getAssetUsd = async (swap: Swap, assetId: string): Promise<string | undefined> => {
  if (assetId === swap.sellAsset.assetId) return swap.sellAssetUsd ?? undefined
  if (assetId === swap.buyAsset.assetId) return swap.buyAssetUsd ?? undefined

  const priceUsd = await getAssetPriceUsdAt(assetId, swap.createdAt)

  return priceUsd?.toString()
}

const isTreasury = ({ recipient }: RelayAppFee) => TREASURY_ACCOUNTS.includes(recipient?.toLowerCase() ?? '')

export const verifyRelay: Verifier = async (swap, deps) => {
  const relayId = getSwapMetadata(swap.metadata, 'relay')?.relayId
  if (!relayId) return noAffiliateResult('FAILED', 'Missing relayId in relay metadata')

  const request = await fetchRelayRequest(relayId, deps)
  if (!request?.data) return noAffiliateResult('PENDING', 'No request data returned from Relay API')

  switch (request.status) {
    case 'success':
      break
    case 'failure':
    case 'refund':
      return noAffiliateResult('FAILED', `Relay request ${request.status}`)
    default:
      return noAffiliateResult('PENDING', `Relay request ${request.status ?? 'without a status'}`)
  }

  // the client reports the sell tx, so it must be one Relay executed for this request
  const sellTxHash = swap.sellTxHash?.toLowerCase()
  if (!request.data.inTxs?.some(({ txHash }) => txHash?.toLowerCase() === sellTxHash)) {
    return noAffiliateResult('PENDING', `Sell tx ${swap.sellTxHash} is not an origin tx of Relay request ${relayId}`)
  }

  // a same-chain swap has no destination leg, so what it received is the origin's output
  const { origin, destination } = request.data.route?.actual ?? {}
  const received = destination ? destination.outputCurrency : origin?.outputCurrency

  const amounts = {
    verifiedSellAmountCryptoBaseUnit: origin?.inputCurrency?.amount,
    actualBuyAmountCryptoBaseUnit: received?.amount,
  }

  // the referrer is only returned for requests made with our API key, which every quote we register is
  if (request.data.referrer?.toLowerCase() !== REFERRER) {
    return { ...noAffiliateResult('SUCCESS', 'Relay request was not made with the ShapeShift API key'), ...amounts }
  }

  const { actual = [], quoted = [], currency } = request.data.appFees ?? {}

  // only the fee Relay reports as collected counts, so a quote it never charged earns nothing
  const fee = actual.find(isTreasury)
  if (!fee?.amount || BigInt(fee.amount) === 0n) {
    const quotedFee = quoted.find(isTreasury)
    if (quotedFee?.amount && BigInt(quotedFee.amount) > 0n) {
      return noAffiliateResult('PENDING', 'Relay has not reported the collected app fee yet')
    }

    return { ...noAffiliateResult('SUCCESS', 'Relay collected no ShapeShift app fee'), ...amounts }
  }

  // a share other than the one charged would misprice payouts
  if (Number(fee.bps) !== swap.affiliateBps) {
    return noAffiliateResult(
      'PENDING',
      `Relay app fee of ${fee.bps} bps differs from the swap's ${swap.affiliateBps} bps`,
    )
  }

  // the fee currency can be the sell asset, the buy asset, or neither, depending on the route
  const actualAffiliateFeeAssetId = currency ? toAssetId(currency) : undefined
  const actualAffiliateFeeUsd = actualAffiliateFeeAssetId
    ? await getAssetUsd(swap, actualAffiliateFeeAssetId)
    : undefined

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: true,
    affiliateBps: swap.affiliateBps,
    affiliateAddress: fee.recipient,
    ...amounts,
    actualAffiliateFeeAmountCryptoBaseUnit: fee.amount,
    actualAffiliateFeeAssetId,
    actualAffiliateFeeUsd,
  }
}
