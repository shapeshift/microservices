export interface ThorchainMayaTxResponse {
  observed_tx?: {
    tx?: {
      memo?: string
      coins?: Array<{ amount?: string }>
    }
  }
}

export interface RelayAppFee {
  bps?: string
  recipient?: string
}

export interface RelayRequest {
  referrer?: string
  data?: {
    appFees?: RelayAppFee[]
    paidAppFees?: RelayAppFee[]
    inTxs?: Array<{ data?: { value?: string } }>
    metadata?: { currencyIn?: { amount?: string } }
  }
}

export interface RelayRequestsResponse {
  requests?: RelayRequest[]
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
