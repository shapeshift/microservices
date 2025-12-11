import axios from 'axios';
import { Asset } from '@shapeshiftoss/types';

// Simple in-memory cache
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Map chain IDs to CoinGecko platform IDs
const chainIdToPlatform: Record<string, string> = {
  'eip155:1': 'ethereum',
  'eip155:43114': 'avalanche',
  'eip155:10': 'optimistic-ethereum',
  'eip155:56': 'binance-smart-chain',
  'eip155:137': 'polygon-pos',
  'eip155:100': 'xdai',
  'eip155:42161': 'arbitrum-one',
  'eip155:42170': 'arbitrum-nova',
  'eip155:8453': 'base',
  'bip122:000000000019d6689c085ae165831e93': 'bitcoin',
  'bip122:00000000001a91e3dace36e2be3bf030': 'dogecoin',
  'bip122:12a765e31ffd4059bada1e25190f6e98': 'litecoin',
  'bip122:000000000000000000651ef99cb9fcbe': 'bitcoin-cash',
  'cosmos:cosmoshub-4': 'cosmos',
  'cosmos:thorchain-mainnet-v1': 'thorchain',
  'cosmos:mayachain-mainnet-v1': 'cacao',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'solana',
};

// Get CoinGecko contract address from asset
function getContractAddress(asset: Asset): string | null {
  const assetIdStr = String(asset.assetId);
  const chainIdStr = String(asset.chainId);

  // For native tokens, assetId equals chainId OR contains slip44
  // Examples: "eip155:1" or "eip155:1/slip44:60" (both are native ETH)
  if (assetIdStr === chainIdStr || assetIdStr.includes('slip44')) {
    return null;
  }

  // Extract contract address from assetId (format: chainId/0x...)
  const parts = assetIdStr.split('/');
  if (parts.length === 2 && parts[1].startsWith('0x')) {
    return parts[1].toLowerCase();
  }

  return null;
}

export async function getAssetPriceUsd(asset: Asset): Promise<number | null> {
  const cacheKey = asset.assetId;

  // Check cache
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const platform = chainIdToPlatform[asset.chainId];
    if (!platform) {
      console.warn(`No CoinGecko platform mapping for chainId: ${asset.chainId}`);
      return null;
    }

    const contractAddress = getContractAddress(asset);
    let price: number | null = null;

    if (contractAddress) {
      // ERC-20 token - look up by contract address
      const { data } = await axios.get(
        `https://api.coingecko.com/api/v3/simple/token_price/${platform}`,
        {
          params: {
            contract_addresses: contractAddress,
            vs_currencies: 'usd',
          },
          timeout: 5000,
        }
      );

      price = data[contractAddress]?.usd || null;
    } else {
      // Native token - look up by platform
      const { data } = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: platform,
            vs_currencies: 'usd',
          },
          timeout: 5000,
        }
      );

      price = data[platform]?.usd || null;
    }

    if (price !== null) {
      // Cache the result
      priceCache.set(cacheKey, { price, timestamp: Date.now() });
    }

    return price;
  } catch (error) {
    console.error(`Failed to fetch price for ${asset.assetId}:`, error);
    return null;
  }
}

export function calculateUsdValue(cryptoAmount: string, priceUsd: number): string {
  try {
    const amount = parseFloat(cryptoAmount);
    if (isNaN(amount)) return '0';

    const usdValue = amount * priceUsd;
    return usdValue.toFixed(2);
  } catch (error) {
    console.error('Failed to calculate USD value:', error);
    return '0';
  }
}
