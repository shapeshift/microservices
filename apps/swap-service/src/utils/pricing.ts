import { Logger } from '@nestjs/common'
import axios from 'axios'

import { adapters } from '@shapeshiftoss/caip'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'

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

export async function getAssetPriceUsd(assetId: string): Promise<number | null> {
  const cached = priceCache.get(assetId)
  if (cached !== undefined) return cached

  try {
    const url = adapters.makeCoingeckoAssetUrl(assetId)
    if (!url) {
      logger.warn(`No CoinGecko URL mapping for assetId: ${assetId}`)
      return null
    }

    const { data } = await axios.get<CoinGeckoAssetData>(url, { timeout: 5000 })

    const price = data?.market_data?.current_price?.usd
    if (!price) {
      logger.warn(`No price data found for ${assetId}`)
      return null
    }

    priceCache.set(assetId, price)
    setTimeout(() => priceCache.delete(assetId), CACHE_TTL_MS).unref()

    return price
  } catch (error) {
    logger.error(`Failed to fetch price for ${assetId}:`, error)
    return null
  }
}

export function calculateUsdValue(cryptoAmount: string, priceUsd: number): string {
  return bnOrZero(cryptoAmount).times(priceUsd).toFixed()
}
