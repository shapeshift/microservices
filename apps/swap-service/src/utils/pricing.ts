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

type CoinGeckoMarketChart = {
  prices: [number, number][]
}

const HOUR_MS = 60 * 60 * 1000

// widened only when the narrow window holds no points, so a swap is never priced off a distant day
const HISTORICAL_WINDOWS_MS = [HOUR_MS, 24 * HOUR_MS]

// The spot price nearest a past instant, so a retried price matches when the swap happened
export async function getAssetPriceUsdAt(assetId: string, at: Date): Promise<number | null> {
  const url = adapters.makeCoingeckoAssetUrl(assetId)
  if (!url) {
    logger.warn(`No CoinGecko URL mapping for assetId: ${assetId}`)
    return null
  }

  const time = at.getTime()

  try {
    for (const windowMs of HISTORICAL_WINDOWS_MS) {
      const { data } = await axios.get<CoinGeckoMarketChart>(`${url}/market_chart/range`, {
        params: {
          vs_currency: 'usd',
          from: Math.floor((time - windowMs) / 1000),
          to: Math.ceil((time + windowMs) / 1000),
        },
        timeout: 5000,
      })

      const prices = (data?.prices ?? []).filter(([, price]) => price > 0)
      if (prices.length === 0) continue

      const [, price] = prices.reduce((nearest, point) =>
        Math.abs(point[0] - time) < Math.abs(nearest[0] - time) ? point : nearest,
      )

      return price
    }

    logger.warn(`No historical price data found for ${assetId} at ${at.toISOString()}`)
    return null
  } catch (error) {
    logger.error(`Failed to fetch historical price for ${assetId} at ${at.toISOString()}:`, error)
    return null
  }
}

export function calculateUsdValue(cryptoAmount: string, priceUsd: number): string {
  return bnOrZero(cryptoAmount).times(priceUsd).toFixed()
}
