import { Logger } from '@nestjs/common'
import axios from 'axios'

import { HOUR_MS, MINUTE_MS } from '../swaps/constants'

const logger = new Logger('Assets')

// the web app's generated asset list, whose manifest hash changes whenever the list does
const ASSET_DATA_BASE_URL = 'https://app.shapeshift.com/generated'
const REFRESH_MS = HOUR_MS
const RETRY_MS = 5 * MINUTE_MS

type AssetManifest = { assetData: string }
type AssetData = { byId: Record<string, { precision: number }> }

let precisions: Map<string, number> | undefined
let version: string | undefined
let nextCheckAt = 0
let refreshing: Promise<void> | undefined

const refresh = async (): Promise<void> => {
  try {
    const { data: manifest } = await axios.get<AssetManifest>(`${ASSET_DATA_BASE_URL}/asset-manifest.json`, {
      timeout: 10_000,
    })

    if (!precisions || manifest.assetData !== version) {
      const { data } = await axios.get<AssetData>(
        `${ASSET_DATA_BASE_URL}/generatedAssetData.json?v=${manifest.assetData}`,
        { timeout: 60_000 },
      )

      precisions = new Map(Object.entries(data.byId).map(([assetId, asset]) => [assetId, asset.precision]))
      version = manifest.assetData
      logger.log(`Loaded ${precisions.size} asset precisions (asset data ${version})`)
    }

    nextCheckAt = Date.now() + REFRESH_MS
  } catch (error) {
    logger.error('Failed to load asset data:', error)
    nextCheckAt = Date.now() + RETRY_MS
  }
}

// only the first load is waited on; later refreshes run behind the cached list, which a failed one keeps
export async function getAssetPrecisions(): Promise<ReadonlyMap<string, number>> {
  if (Date.now() >= nextCheckAt) refreshing ??= refresh().finally(() => (refreshing = undefined))
  if (!precisions) await refreshing

  if (!precisions) throw new Error('Asset list unavailable')

  return precisions
}

// for reporting, where a fee in a third asset is left unvalued rather than failing the whole request;
// the failed refresh has already logged why
export async function tryGetAssetPrecisions(): Promise<ReadonlyMap<string, number> | undefined> {
  try {
    return await getAssetPrecisions()
  } catch {
    return
  }
}
