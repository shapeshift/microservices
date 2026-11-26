export type RelayToken = {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
}

export type RelayAppFee = {
  recipient?: string
  bps?: string
  amount?: string
}

export type RelayRouteLeg = {
  inputCurrency?: { currency?: RelayToken; amount?: string }
  outputCurrency?: { currency?: RelayToken; amount?: string }
}

// GET /requests/v3, trimmed to the fields verification reads
export type RelayRequest = {
  id?: string
  status?: string
  data?: {
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

export type RelayRequestsResponse = {
  requests?: RelayRequest[]
}
