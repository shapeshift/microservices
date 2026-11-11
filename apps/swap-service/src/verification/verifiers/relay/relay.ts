import { firstValueFrom } from 'rxjs'

import { relayTokenToAssetId } from '@shapeshiftoss/swapper'

import { env } from '../../../env'
import type { Swap } from '../../../swaps/types'
import { getAssetPriceUsdAt } from '../../../utils/pricing'
import type { Verifier, VerifierDeps } from '../../types'
import { getSwapMetadata, noAffiliateResult } from '../../utils'

const REFERRER = 'shapeshift'
// Relay routes affiliate fees to our BASE-chain treasury
const AFFILIATE_ADDRESS = '0x9c9aa90363630d4ab1d9dbf416cc3bbc8d3ed502'

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
    // authenticated data: only returned for requests created with our API key
    referrer?: string | null
    appFees?: {
      quoted?: RelayAppFee[]
      actual?: RelayAppFee[]
      currency?: RelayToken
    }
    route?: {
      // actual falls back to quoted until Relay has execution data
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

export const verifyRelay: Verifier = async (swap, deps) => {
  const relayId = getSwapMetadata(swap.metadata, 'relay')?.relayId
  if (!relayId) return noAffiliateResult('FAILED', 'Missing relayId in relay metadata')

  const request = await fetchRelayRequest(relayId, deps)
  if (!request?.data) return noAffiliateResult('PENDING', 'No request data returned from Relay API')

  // the referrer is only returned for requests made with our API key, which every quote we register is
  const isShapeshiftReferral = request.data.referrer?.toLowerCase() === REFERRER

  // the fee actually collected, or the quoted one until Relay reports it
  const { actual, quoted, currency } = request.data.appFees ?? {}
  const appFees = actual?.length ? actual : (quoted ?? [])

  const shapeshiftFee = isShapeshiftReferral
    ? appFees.find(({ recipient }) => recipient?.toLowerCase() === AFFILIATE_ADDRESS)
    : undefined

  const parsedBps = Number(shapeshiftFee?.bps)
  const affiliateBps = Number.isFinite(parsedBps) ? parsedBps : undefined

  // the fee currency can be the sell asset, the buy asset, or neither, depending on the route
  const actualAffiliateFeeAssetId = shapeshiftFee && currency ? toAssetId(currency) : undefined
  const actualAffiliateFeeUsd = actualAffiliateFeeAssetId
    ? await getAssetUsd(swap, actualAffiliateFeeAssetId)
    : undefined

  // a same-chain swap has no destination leg, so what it received is the origin's output
  const { origin, destination } = request.data.route?.actual ?? {}
  const received = destination ? destination.outputCurrency : origin?.outputCurrency

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: Boolean(shapeshiftFee),
    affiliateBps,
    affiliateAddress: shapeshiftFee?.recipient,
    verifiedSellAmountCryptoBaseUnit: origin?.inputCurrency?.amount,
    actualBuyAmountCryptoBaseUnit: received?.amount,
    actualAffiliateFeeAmountCryptoBaseUnit: shapeshiftFee?.amount,
    actualAffiliateFeeAssetId,
    actualAffiliateFeeUsd,
  }
}
