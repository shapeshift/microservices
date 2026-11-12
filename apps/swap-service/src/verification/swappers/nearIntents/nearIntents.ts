import { GetExecutionStatusResponse, OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript'

import { env } from '../../../env'
import type { Verifier } from '../../types'
import { ceilDiv, getSwapMetadata, noAffiliateResult } from '../../utils'

const REFERRAL = 'shapeshift'
const BPS_DENOMINATOR = 10_000n
const STATUS_TIMEOUT_MS = 15_000

export const TREASURY_ACCOUNTS = ['shapeshifttokenomics.sputnik-dao.near']

OpenAPI.BASE = 'https://1click.chaindefuser.com'
OpenAPI.TOKEN = env.VITE_NEAR_INTENTS_API_KEY

const getExecutionStatus = async (depositAddress: string, depositMemo?: string) => {
  const request = OneClickService.getExecutionStatus(depositAddress, depositMemo)
  const timer = setTimeout(() => request.cancel(), STATUS_TIMEOUT_MS)

  try {
    return await request
  } finally {
    clearTimeout(timer)
  }
}

export const verifyNearIntents: Verifier = async (swap) => {
  const nearIntents = getSwapMetadata(swap.metadata, 'nearIntents')
  if (!nearIntents?.depositAddress) return noAffiliateResult('FAILED', 'Missing depositAddress in nearIntents metadata')

  const { status, quoteResponse, swapDetails } = await getExecutionStatus(
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

  const { referral, appFees = [] } = quoteResponse.quoteRequest

  // the executed input, which excludes any over-deposit 1Click refunded
  const verifiedSellAmountCryptoBaseUnit = swapDetails.amountIn
  if (!verifiedSellAmountCryptoBaseUnit) return noAffiliateResult('PENDING', 'Missing executed amountIn from 1Click')

  const amounts = { verifiedSellAmountCryptoBaseUnit, actualBuyAmountCryptoBaseUnit: swapDetails.amountOut }

  // 1Click reports the treasury's share after taking its own cut of the requested fee
  const appFee =
    referral?.toLowerCase() === REFERRAL
      ? appFees.find(({ recipient }) => TREASURY_ACCOUNTS.includes(recipient))
      : undefined

  if (!appFee) return { ...noAffiliateResult('SUCCESS', 'No ShapeShift app fee on the 1Click quote'), ...amounts }

  // trusts 1Click to pay the fee it reports, rounded up as 1Click does when it settles on chain
  const feeAmount = ceilDiv(BigInt(verifiedSellAmountCryptoBaseUnit) * BigInt(appFee.fee), BPS_DENOMINATOR)
  if (feeAmount === 0n) return { ...noAffiliateResult('SUCCESS', '1Click charged a 0 ShapeShift app fee'), ...amounts }

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: true,
    affiliateBps: appFee.fee,
    affiliateAddress: appFee.recipient,
    ...amounts,
    actualAffiliateFeeAmountCryptoBaseUnit: feeAmount.toString(),
  }
}
