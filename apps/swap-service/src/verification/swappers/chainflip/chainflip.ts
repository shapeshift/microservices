import type { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'

import { usdcAssetId } from '@shapeshiftoss/caip'

import { env } from '../../../env'
import type { Verifier } from '../../types'
import { getSwapMetadata, noAffiliateResult } from '../../utils'

import type { ChainflipExplorerResponse, ChainflipStatus, ChainflipStatusResponse, ChainflipSwapRequest } from './types'

export const TREASURY_ACCOUNTS = ['cFMeDPtPHccVYdBSJKTtCYuy7rewFNpro3xZBKaCGbSS2xhRi']

const GET_SWAP_BY_NATIVE_ID_QUERY = `query GetSwapByNativeId($nativeId: BigInt!) {
  swapRequest: swapRequestByNativeId(nativeId: $nativeId) {
    completedEventId
    executedSwaps: swapsBySwapRequestId(
      filter: { swapExecutedEventId: { isNull: false }, type: { notEqualTo: GAS } }
    ) {
      aggregates {
        sum {
          swapInputAmount
        }
      }
    }
    egress: egressByEgressId {
      amount
    }
    beneficiaries: swapRequestBeneficiariesBySwapRequestId {
      nodes {
        type
        brokerCommissionRateBps
        commissions: swapCommissionsBySwapRequestBeneficiaryId {
          groupedAggregates(groupBy: ASSET) {
            asset: keys
            sum {
              amount
            }
          }
        }
        account: accountByAccountId {
          idSs58
        }
      }
    }
  }
}`

const fetchStatus = async (id: number | string, http: HttpService): Promise<ChainflipStatus | undefined> => {
  const { data } = await firstValueFrom(
    http.get<ChainflipStatusResponse>(
      `${env.VITE_CHAINFLIP_API_URL}/status-by-id?swapId=${encodeURIComponent(String(id))}`,
      { headers: { 'X-API-Key': env.VITE_CHAINFLIP_API_KEY } },
    ),
  )

  return data?.status
}

const fetchSwapRequest = async (nativeId: string, http: HttpService): Promise<ChainflipSwapRequest | undefined> => {
  const { data } = await firstValueFrom(
    http.post<ChainflipExplorerResponse>(env.VITE_CHAINFLIP_EXPLORER_URL, {
      operationName: 'GetSwapByNativeId',
      query: GET_SWAP_BY_NATIVE_ID_QUERY,
      variables: { nativeId },
    }),
  )

  if (data?.errors?.length) {
    throw new Error(`Chainflip explorer error: ${data.errors.map(({ message }) => message).join('; ')}`)
  }

  return data?.data?.swapRequest ?? undefined
}

export const verifyChainflip: Verifier = async (swap, { http }) => {
  const chainflip = getSwapMetadata(swap.metadata, 'chainflip')
  if (!chainflip?.swapId) return noAffiliateResult('FAILED', 'Missing swapId in chainflip metadata')

  const status = await fetchStatus(chainflip.swapId, http)
  if (!status) return noAffiliateResult('PENDING', 'No status returned from the Chainflip broker')

  if (!status.swapId) {
    if (status.state === 'failed') return noAffiliateResult('FAILED', 'Chainflip swap failed')
    return noAffiliateResult('PENDING', `Chainflip swap ${status.state ?? 'without a state'}`)
  }

  const swapRequest = await fetchSwapRequest(status.swapId, http)
  if (!swapRequest) return noAffiliateResult('PENDING', 'No swap request returned from the Chainflip explorer')

  if (!swapRequest.completedEventId) return noAffiliateResult('PENDING', 'Chainflip swap request not completed yet')

  const verifiedSellAmountCryptoBaseUnit = swapRequest.executedSwaps?.aggregates?.sum?.swapInputAmount
  if (!verifiedSellAmountCryptoBaseUnit) {
    return noAffiliateResult('PENDING', 'Chainflip has not reported the executed swap yet')
  }

  if (BigInt(verifiedSellAmountCryptoBaseUnit) === 0n) {
    return noAffiliateResult('FAILED', status.refundEgress ? 'Chainflip swap refunded' : 'Chainflip swap not executed')
  }

  const amounts = { verifiedSellAmountCryptoBaseUnit, actualBuyAmountCryptoBaseUnit: swapRequest.egress?.amount }

  const affiliate = swapRequest.beneficiaries?.nodes?.find(
    ({ type, account }) => type === 'AFFILIATE' && TREASURY_ACCOUNTS.includes(account?.idSs58 ?? ''),
  )

  if (!affiliate) return noAffiliateResult('SUCCESS', 'Chainflip swap names no ShapeShift affiliate', amounts)

  if (!affiliate.brokerCommissionRateBps) {
    return noAffiliateResult('SUCCESS', 'Chainflip affiliate commission is 0 bps', amounts)
  }

  const commissions = affiliate.commissions?.groupedAggregates ?? []

  if (!commissions.length) return noAffiliateResult('PENDING', 'Chainflip has not indexed the affiliate commission yet')

  if (commissions.some(({ asset }) => asset?.[0] !== 'Usdc')) {
    const assets = commissions.map(({ asset }) => asset?.[0]).join(', ')
    return noAffiliateResult('PENDING', `Chainflip affiliate commission is in ${assets}, not only USDC`)
  }

  const [commission] = commissions

  if (!commission.sum?.amount) return noAffiliateResult('PENDING', 'Chainflip has not reported the commission amount')

  const feeAmount = BigInt(commission.sum.amount)
  if (feeAmount === 0n) return noAffiliateResult('SUCCESS', 'Chainflip collected a 0 affiliate commission', amounts)

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: true,
    affiliateBps: affiliate.brokerCommissionRateBps,
    affiliateAddress: affiliate.account?.idSs58,
    ...amounts,
    actualAffiliateFeeAmountCryptoBaseUnit: feeAmount.toString(),
    actualAffiliateFeeAssetId: usdcAssetId,
  }
}
