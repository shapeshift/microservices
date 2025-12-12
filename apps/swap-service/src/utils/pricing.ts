import axios from 'axios';
import { Asset } from '@shapeshiftoss/types';
import { adapters } from '@shapeshiftoss/caip';

// Simple in-memory cache
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CoinGeckoAssetData = {
  market_data: {
    current_price: {
      usd: number;
    };
  };
};

export async function getAssetPriceUsd(asset: Asset): Promise<number | null> {
  const cacheKey = asset.assetId;

  // Check cache
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    // Use CAIP adapters to dynamically get CoinGecko URL for any supported asset
    const url = adapters.makeCoingeckoAssetUrl(asset.assetId);

    if (!url) {
      console.warn(`No CoinGecko URL mapping for assetId: ${asset.assetId}`);
      return null;
    }

    // Fetch price from CoinGecko
    const { data } = await axios.get<CoinGeckoAssetData>(url, { timeout: 5000 });
    const price = data?.market_data?.current_price?.usd || null;

    if (price !== null) {
      // Cache the result
      priceCache.set(cacheKey, { price, timestamp: Date.now() });
      return price;
    } else {
      console.warn(`No price data found for ${asset.assetId} (symbol: ${asset.symbol})`);
      return null;
    }
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
