import { SwapperName } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

type FeeAssetStrategy = 'buy_asset' | 'sell_asset' | 'none'

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
  [SwapperName.Relay]: 'none',
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
    default:
      return null
  }
}
