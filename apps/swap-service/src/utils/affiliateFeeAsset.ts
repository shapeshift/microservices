import type { AssetId } from '@shapeshiftoss/caip'
import { mayachainAssetId, thorchainAssetId } from '@shapeshiftoss/caip'
import { SwapperName } from '@shapeshiftoss/swapper'
import type { Asset } from '@shapeshiftoss/types'

type FeeAssetStrategy = 'buy_asset' | 'sell_asset' | AssetId | null

const SWAPPER_FEE_STRATEGY: Record<SwapperName, FeeAssetStrategy> = {
  [SwapperName.Across]: 'buy_asset',
  [SwapperName.ArbitrumBridge]: null,
  [SwapperName.Avnu]: 'sell_asset',
  [SwapperName.Bebop]: 'buy_asset',
  [SwapperName.ButterSwap]: 'buy_asset',
  [SwapperName.Cetus]: 'buy_asset',
  [SwapperName.Chainflip]: 'buy_asset',
  [SwapperName.CowSwap]: 'sell_asset',
  [SwapperName.Debridge]: 'sell_asset',
  [SwapperName.Mayachain]: mayachainAssetId,
  [SwapperName.NearIntents]: 'sell_asset',
  [SwapperName.Portals]: 'sell_asset',
  [SwapperName.Relay]: null,
  [SwapperName.Stonfi]: 'sell_asset',
  [SwapperName.Sunio]: 'buy_asset',
  [SwapperName.Thorchain]: thorchainAssetId,
  [SwapperName.Zrx]: 'buy_asset',
  [SwapperName.Test]: null,
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
      return strategy
  }
}
