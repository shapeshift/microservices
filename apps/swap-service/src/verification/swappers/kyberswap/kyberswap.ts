import type { Address, Hex } from 'viem'
import { isAddressEqual, parseAbi, parseEventLogs } from 'viem'

import { fromAssetId, toAssetId } from '@shapeshiftoss/caip'
import { viemClientByChainId } from '@shapeshiftoss/contracts'
import { getTreasuryAddressFromChainId } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../swaps/types'
import type { Verifier } from '../../types'
import { noAffiliateResult } from '../../utils'

const BPS_DENOMINATOR = 10_000n

// MetaAggregationRouterV2, same address on every chain
export const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'
const KYBER_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const KYBER_ROUTER_ABI = parseAbi([
  'event Fee(address token, uint256 totalAmount, uint256 totalFee, address[] recipients, uint256[] amounts, bool isBps)',
  'event Swapped(address sender, address srcToken, address dstToken, address dstReceiver, uint256 spentAmount, uint256 returnAmount)',
])

// the router reports native as a sentinel address, so take the native asset from whichever side of the swap is native
const tokenToAssetId = (swap: Swap, token: Address): string | undefined => {
  const { chainId } = swap.sellAsset

  if (!isAddressEqual(token, KYBER_NATIVE_TOKEN)) {
    return toAssetId({ chainId, assetNamespace: 'erc20', assetReference: token.toLowerCase() })
  }

  return [swap.sellAsset, swap.buyAsset].find(
    ({ assetId }) => fromAssetId(assetId).chainId === chainId && fromAssetId(assetId).assetNamespace === 'slip44',
  )?.assetId
}

export const verifyKyberSwap: Verifier = async (swap) => {
  if (!swap.sellTxHash) return noAffiliateResult('FAILED', 'Missing sellTxHash for KyberSwap verification')

  const { chainId } = swap.sellAsset

  const client = viemClientByChainId[chainId]
  if (!client) return noAffiliateResult('PENDING', `No RPC client for ${chainId}`)

  const receipt = await client.getTransactionReceipt({ hash: swap.sellTxHash as Hex })
  if (receipt.status !== 'success') return noAffiliateResult('FAILED', 'KyberSwap transaction reverted')

  const events = parseEventLogs({ abi: KYBER_ROUTER_ABI, logs: receipt.logs }).filter(({ address }) =>
    isAddressEqual(address, KYBER_ROUTER),
  )

  const swaps = events.filter((event) => event.eventName === 'Swapped')
  if (!swaps.length) return noAffiliateResult('FAILED', 'No KyberSwap router swap in the transaction')

  // a batched tx can hold several router swaps, and its fees can't be told apart
  if (swaps.length > 1) return noAffiliateResult('PENDING', 'KyberSwap transaction contains more than one router swap')

  const [swapped] = swaps

  // a fee taken from the input is left out of spentAmount, so the sell is that Fee event's totalAmount
  const inputFee = events.find(
    (event) => event.eventName === 'Fee' && isAddressEqual(event.args.token, swapped.args.srcToken),
  )

  const amounts = {
    verifiedSellAmountCryptoBaseUnit: (inputFee?.eventName === 'Fee'
      ? inputFee.args.totalAmount
      : swapped.args.spentAmount
    ).toString(),
    actualBuyAmountCryptoBaseUnit: swapped.args.returnAmount.toString(),
  }

  const treasury = getTreasuryAddressFromChainId(chainId) as Address

  const fees = events.flatMap((event) => {
    if (event.eventName !== 'Fee') return []

    const { token, totalAmount, recipients, amounts: values, isBps } = event.args

    return recipients.flatMap((recipient, i) => {
      const value = values[i]
      if (value === undefined || !isAddressEqual(recipient, treasury)) return []

      return [{ token, totalAmount, value, isBps }]
    })
  })

  if (!fees.length) return noAffiliateResult('SUCCESS', 'No ShapeShift fee in the KyberSwap Fee event', amounts)

  // our quotes carry one fee recipient, so several treasury fees are flagged rather than combined
  if (fees.length > 1) return noAffiliateResult('PENDING', 'KyberSwap reports more than one fee to the treasury')

  const [fee] = fees

  // our quotes always charge in bps, so an absolute fee wasn't built from one of them
  if (!fee.isBps) return noAffiliateResult('PENDING', 'KyberSwap fee is an absolute amount, not bps')

  const feeAmount = (fee.totalAmount * fee.value) / BPS_DENOMINATOR
  if (feeAmount === 0n) return noAffiliateResult('SUCCESS', 'KyberSwap collected a 0 fee', amounts)

  const actualAffiliateFeeAssetId = tokenToAssetId(swap, fee.token)
  if (!actualAffiliateFeeAssetId) return noAffiliateResult('PENDING', 'KyberSwap fee token has no known asset')

  return {
    verificationStatus: 'SUCCESS',
    hasAffiliate: true,
    affiliateBps: Number(fee.value),
    affiliateAddress: treasury,
    ...amounts,
    actualAffiliateFeeAmountCryptoBaseUnit: feeAmount.toString(),
    actualAffiliateFeeAssetId,
  }
}
