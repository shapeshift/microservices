import { SwapperName } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

type FeeAssetStrategy = 'buy_asset' | 'sell_asset' | 'fixed_base' | 'none'

const SWAPPER_FEE_STRATEGY: Record<SwapperName, FeeAssetStrategy> = {
  [SwapperName.Across]: 'buy_asset',
  [SwapperName.ArbitrumBridge]: 'none',
  [SwapperName.Avnu]: 'sell_asset',
  [SwapperName.Bebop]: 'buy_asset',
  [SwapperName.ButterSwap]: 'buy_asset',
  [SwapperName.Cetus]: 'buy_asset',
  [SwapperName.Chainflip]: 'buy_asset',
  [SwapperName.CowSwap]: 'sell_asset',
  [SwapperName.Debridge]: 'sell_asset',
  [SwapperName.Mayachain]: 'sell_asset',
  [SwapperName.NearIntents]: 'sell_asset',
  [SwapperName.Portals]: 'sell_asset',
  [SwapperName.Relay]: 'fixed_base',
  [SwapperName.Stonfi]: 'sell_asset',
  [SwapperName.Sunio]: 'buy_asset',
  [SwapperName.Thorchain]: 'sell_asset',
  [SwapperName.Zrx]: 'buy_asset',
  [SwapperName.Test]: 'none',
}

export function resolveAffiliateFeeAssetId(swapperName: SwapperName, sellAsset: Asset, buyAsset: Asset): string | null {
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
