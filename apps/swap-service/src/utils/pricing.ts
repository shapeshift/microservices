import { Logger } from '@nestjs/common'
import axios from 'axios'

import { adapters } from '@shapeshiftoss/caip'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'
import type { Asset } from '@shapeshiftoss/types'

const logger = new Logger('Pricing')

const priceCache = new Map<string, number>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

type CoinGeckoAssetData = {
  market_data: {
    current_price: {
      usd: number
    }
  }
}

export async function getAssetPriceUsd(asset: Asset): Promise<number | null> {
  const cacheKey = asset.assetId

  const cached = priceCache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const url = adapters.makeCoingeckoAssetUrl(asset.assetId)
    if (!url) {
      logger.warn(`No CoinGecko URL mapping for assetId: ${asset.assetId}`)
      return null
    }

    const { data } = await axios.get<CoinGeckoAssetData>(url, { timeout: 5000 })

    const price = data?.market_data?.current_price?.usd
    if (!price) {
      logger.warn(`No price data found for ${asset.assetId} (symbol: ${asset.symbol})`)
      return null
    }

    priceCache.set(cacheKey, price)
    setTimeout(() => priceCache.delete(cacheKey), CACHE_TTL_MS).unref()

    return price
  } catch (error) {
    logger.error(`Failed to fetch price for ${asset.assetId}:`, error)
    return null
  }
}

export function calculateUsdValue(cryptoAmount: string, priceUsd: number): string {
  return bnOrZero(cryptoAmount).times(priceUsd).toFixed()
}
