export interface ThorchainMayaTxResponse {
  observed_tx?: {
    tx?: {
      memo?: string
      coins?: Array<{ amount?: string }>
    }
  }
}

export type MidgardCoin = {
  amount: string
  asset: string
}

export type MidgardInTransaction = {
  address: string
  coins: MidgardCoin[]
  txID: string
}

export type MidgardOutTransaction = {
  address: string
  affiliate?: boolean
  coins: MidgardCoin[]
  height: string
  txID: string
}

export type MidgardSwapMetadata = {
  affiliateAddress: string
  affiliateFee: string
  inPriceUSD: string
  isStreamingSwap: boolean
  liquidityFee: string
  memo: string
  networkFees: MidgardCoin[]
  outPriceUSD: string
  swapSlip: string
  swapTarget: string
  txType: string
}

export type MidgardAction = {
  date: string
  height: string
  in: MidgardInTransaction[]
  metadata: {
    swap?: MidgardSwapMetadata
  }
  out: MidgardOutTransaction[]
  pools: string[]
  status: 'pending' | 'success' | 'failed'
  type: string
}

export type MidgardActionsResponse = {
  actions: MidgardAction[]
}

interface RelayAppFee {
  recipient?: string
  bps?: string
  amount?: string
  amountUsd?: string
  amountUsdCurrent?: string
}

interface RelayToken {
  chainId?: number
  address?: string
  symbol?: string
  name?: string
  decimals?: number
}

interface RelayCurrencyAmount {
  currency?: RelayToken
  amount?: string
  amountFormatted?: string
  amountUsd?: string
  amountUsdCurrent?: string
  minimumAmount?: string
}

export interface RelayRequestsResponse {
  requests?: Array<{
    id?: string
    status?: string
    referrer?: string
    user?: string
    recipient?: string
    createdAt?: string
    updatedAt?: string
    data?: {
      appFees?: Array<RelayAppFee>
      paidAppFees?: Array<RelayAppFee>
      appFeeCurrencyObject?: RelayToken
      metadata?: {
        currencyIn?: RelayCurrencyAmount
        currencyOut?: RelayCurrencyAmount
      }
    }
  }>
}

export interface CowSwapAppDataResponse {
  fullAppData: string
}

export interface CowSwapDecodedAppData {
  appCode?: string
  metadata?: {
    partnerFee?: {
      bps?: number
      recipient?: string
    }
  }
}

export interface CowSwapOrderResponse {
  executedSellAmountBeforeFees?: string
  executedSellAmount?: string
}

export interface PortalsOrderResponse {
  context?: {
    partner?: string
    inputAmount?: string
    feeAmount?: string
    feeAmountUsd?: string
  }
}

export interface ChainflipSwapResponse {
  affiliate?: string
  affiliateName?: string
  affiliateBps?: string
  affiliateFee?: string
  depositAmount?: string
  ingressAmount?: string
  sourceAmount?: string
}

export interface ZrxTrade {
  txHash?: string
  transactionHash?: string
  integratorId?: string
  integratorName?: string
  affiliateName?: string
  integratorFee?: string
  affiliateFee?: string
  partnerFee?: string
  sellAmount?: string
  inputTokenAmount?: string
  amount?: string
}

export interface ZrxApiResponse {
  trades?: ZrxTrade[]
  results?: ZrxTrade[]
}

export interface BebopTrade {
  txHash?: string
  partnerFeeBps?: number
  sellTokens?: Record<string, { amount?: string }>
  partnerFeeNative?: string
}

export interface BebopTradesResponse {
  results?: BebopTrade[]
}

export interface ButterBridgeInfo {
  state?: number
  toHash?: string
  relayerHash?: string
  entrance?: string
  sourceHash?: string
  relayerChain?: { scanUrl?: string }
}

export interface ButterBridgeInfoApiResponse {
  code?: number
  data?: {
    info?: ButterBridgeInfo
  }
}

export interface AcrossDepositStatusResponse {
  status?: 'filled' | 'pending' | 'expired' | 'refunded' | 'slowFillRequested'
  fillTxnRef?: string
  depositTxnRef?: string
  destinationChainId?: number
  originChainId?: number
  depositId?: number
}

export interface StonfiQuoteMetadata {
  quoteId?: string
  referrerAddress?: string
  referrerFeeUnits?: string
  referrerFeeBps?: number
}
