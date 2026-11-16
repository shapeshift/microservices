export type ChainflipCommission = {
  // groupBy keys, e.g. ['Usdc']
  asset?: string[]
  sum?: { amount?: string }
}

export type ChainflipBeneficiary = {
  type?: string
  brokerCommissionRateBps?: number
  commissions?: { groupedAggregates?: ChainflipCommission[] }
  account?: { idSs58?: string }
}

// explorer GetSwapByNativeId, trimmed to the fields verification reads
export type ChainflipSwapRequest = {
  completedEventId?: string | null
  refundEgress?: { amount?: string } | null
  executedSwaps?: { aggregates?: { sum?: { swapInputAmount?: string } } }
  egress?: { amount?: string } | null
  beneficiaries?: { nodes?: ChainflipBeneficiary[] }
}

export type ChainflipExplorerResponse = {
  data?: { swapRequest?: ChainflipSwapRequest | null }
  errors?: { message?: string }[]
}
