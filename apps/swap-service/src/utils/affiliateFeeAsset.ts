import { Asset } from '@shapeshiftoss/types';

type FeeAssetStrategy = 'buy_asset' | 'sell_asset' | 'fixed_base';

const SWAPPER_FEE_STRATEGY: Record<string, FeeAssetStrategy> = {
  THORChain: 'buy_asset',
  MAYAChain: 'buy_asset',
  'CoW Swap': 'buy_asset',
  '0x': 'buy_asset',
  Jupiter: 'buy_asset',
  Chainflip: 'buy_asset',
  Across: 'buy_asset',
  Portals: 'buy_asset',
  Bebop: 'buy_asset',
  ButterSwap: 'buy_asset',
  'STON.fi': 'buy_asset',
  Cetus: 'buy_asset',
  'Sun.io': 'buy_asset',
  'NEAR Intents': 'buy_asset',
  AVNU: 'sell_asset',
  Relay: 'fixed_base',
};

const BASE_USDC_ASSET_ID =
  'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

export function resolveAffiliateFeeAssetId(
  swapperName: string,
  sellAsset: Asset,
  buyAsset: Asset,
): string | null {
  const strategy = SWAPPER_FEE_STRATEGY[swapperName];
  if (!strategy) return null;

  switch (strategy) {
    case 'buy_asset':
      return buyAsset.assetId;
    case 'sell_asset':
      return sellAsset.assetId;
    case 'fixed_base':
      return BASE_USDC_ASSET_ID;
    default:
      return null;
  }
}

export function getSwapperFeeStrategy(
  swapperName: string,
): FeeAssetStrategy | null {
  return SWAPPER_FEE_STRATEGY[swapperName] ?? null;
}

export function resolveAffiliateFeeAsset(
  swapperName: string,
  sellAsset: Asset,
  buyAsset: Asset,
): Asset | null {
  const strategy = SWAPPER_FEE_STRATEGY[swapperName];
  if (!strategy) return null;

  switch (strategy) {
    case 'buy_asset':
      return buyAsset;
    case 'sell_asset':
      return sellAsset;
    case 'fixed_base':
      return null;
    default:
      return null;
  }
}
