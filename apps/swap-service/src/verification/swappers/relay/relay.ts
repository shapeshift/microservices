import { firstValueFrom } from 'rxjs'

import { relayTokenToAssetId } from '@shapeshiftoss/swapper'

import { env } from '../../../env'
import type { Verifier, VerifierDeps } from '../../types'
import { getSwapMetadata, noAffiliateResult } from '../../utils'

import type { RelayAppFee, RelayRequest, RelayRequestsResponse, RelayToken } from './types'

export const TREASURY_ACCOUNTS = ['0x9c9aa90363630d4ab1d9dbf416cc3bbc8d3ed502']

const fetchRelayRequest = async (relayId: string, { http }: VerifierDeps): Promise<RelayRequest | undefined> => {
  const { data } = await firstValueFrom(
    http.get<RelayRequestsResponse>(
      `${env.VITE_RELAY_API_URL}/requests/v3?id=${encodeURIComponent(relayId)}&includeAuthenticatedData=true`,
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

const isTreasury = ({ recipient }: RelayAppFee) => TREASURY_ACCOUNTS.includes(recipient?.toLowerCase() ?? '')

export const verifyRelay: Verifier = async (swap, deps) => {
  const relayId = getSwapMetadata(swap.metadata, 'relay')?.relayId
  if (!relayId) return noAffiliateResult('FAILED', 'Missing relayId in relay metadata')

  const request = await fetchRelayRequest(relayId, deps)
  if (!request) return noAffiliateResult('PENDING', 'No request data returned from Relay API')

  switch (request.status) {
    case 'success':
      break
    case 'failure':
    case 'refund':
      return noAffiliateResult('FAILED', `Relay request ${request.status}`)
    default:
      return noAffiliateResult('PENDING', `Relay request ${request.status ?? 'without a status'}`)
  }

  if (!request.data) return noAffiliateResult('PENDING', 'No request data returned from Relay API')

  // a same-chain swap has no destination leg, so what it received is the origin's output
  const { origin, destination } = request.data.route?.actual ?? {}
  const received = destination ? destination.outputCurrency : origin?.outputCurrency

  const verifiedSellAmountCryptoBaseUnit = origin?.inputCurrency?.amount
  if (!verifiedSellAmountCryptoBaseUnit) {
    return noAffiliateResult('PENDING', 'Relay has not reported the executed route yet')
  }

  const amounts = { verifiedSellAmountCryptoBaseUnit, actualBuyAmountCryptoBaseUnit: received?.amount }

  // app fees are reported on every request, so a request without them isn't fully indexed yet
  if (!request.data.appFees) return noAffiliateResult('PENDING', 'Relay has not reported the app fees yet')

  const { actual = [], quoted = [], currency } = request.data.appFees

  // only the fee Relay reports as collected counts, so a quote it never charged earns nothing
  const fees = actual.filter(isTreasury)

  if (!fees.length) {
    const quotedFee = quoted.find(isTreasury)

    if (quotedFee?.amount && BigInt(quotedFee.amount) > 0n) {
      return noAffiliateResult('PENDING', 'Relay has not reported the collected app fee yet')
    }

    const reason = quotedFee
      ? 'Relay quoted a 0 app fee and collected none'
      : 'Relay request carries no ShapeShift app fee'

    return { ...noAffiliateResult('SUCCESS', reason), ...amounts }
  }

  // a collected fee without an amount isn't fully reported yet, and is not a zero fee
  if (fees.some(({ amount }) => !amount)) {
    return noAffiliateResult('PENDING', 'Relay has not reported the collected app fee amount yet')
  }

  const feeAmount = fees.reduce((total, { amount }) => total + BigInt(amount), 0n)
  if (feeAmount === 0n) return { ...noAffiliateResult('SUCCESS', 'Relay collected a 0 app fee'), ...amounts }

  const [fee] = fees

  // the fee currency can be the sell asset, the buy asset, or neither, depending on the route
  const actualAffiliateFeeAssetId = currency ? toAssetId(currency) : undefined

  // a fee in an unknown asset can't be valued, so wait for the mapping rather than finalize it
  if (!actualAffiliateFeeAssetId) return noAffiliateResult('PENDING', 'Relay app fee currency has no known asset')

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: true,
    affiliateBps: Number(fee.bps),
    affiliateAddress: fee.recipient,
    ...amounts,
    actualAffiliateFeeAmountCryptoBaseUnit: feeAmount.toString(),
    actualAffiliateFeeAssetId,
  }
}
