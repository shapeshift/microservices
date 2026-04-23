import type { Asset } from '@shapeshiftoss/types'

type FeeAssetStrategy = 'buy_asset' | 'sell_asset' | 'fixed_base'

const SWAPPER_FEE_STRATEGY: Record<string, FeeAssetStrategy> = {
  Across: 'buy_asset',
  AVNU: 'sell_asset',
  Bebop: 'buy_asset',
  ButterSwap: 'buy_asset',
  Cetus: 'buy_asset',
  Chainflip: 'buy_asset',
  'CoW Swap': 'sell_asset',
  MAYAChain: 'sell_asset',
  'NEAR Intents': 'sell_asset',
  Portals: 'sell_asset',
  Relay: 'fixed_base',
  'STON.fi': 'sell_asset',
  'Sun.io': 'buy_asset',
  THORChain: 'sell_asset',
  '0x': 'buy_asset',
}

export function resolveAffiliateFeeAssetId(swapperName: string, sellAsset: Asset, buyAsset: Asset): string | null {
  const strategy = SWAPPER_FEE_STRATEGY[swapperName]
  if (!strategy) return null

  switch (strategy) {
    case 'buy_asset':
      return buyAsset.assetId
    case 'sell_asset':
      return sellAsset.assetId
    case 'fixed_base':
      return 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    default:
      return null
  }
}
