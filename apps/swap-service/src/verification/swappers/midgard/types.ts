export type MidgardCoin = {
  amount: string
  asset: string
}

// GET /v2/actions, trimmed to the fields verification reads
export type MidgardAction = {
  type: string
  status: 'pending' | 'success' | 'failed'
  in: Array<{ txID: string; coins: MidgardCoin[] }>
  out: Array<{ address: string; affiliate?: boolean; coins: MidgardCoin[] }>
  metadata: {
    swap?: {
      affiliateAddress: string
      affiliateFee: string
      memo: string
    }
  }
}

export type MidgardActionsResponse = {
  actions: MidgardAction[]
}

export type MidgardConfig = {
  midgardUrl: string
  affiliate: string
  // the chain's native coin, which the affiliate fee is paid in
  nativeAsset: { asset: string; assetId: string; precision: number }
}
