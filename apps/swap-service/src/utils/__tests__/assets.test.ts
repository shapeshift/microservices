const BASE_USDC = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const HOUR = 60 * 60 * 1000

const assetList = (version: string, precision: number) => (url: string) =>
  Promise.resolve({
    data: url.includes('asset-manifest')
      ? { assetData: version }
      : { byId: { [BASE_USDC]: { assetId: BASE_USDC, precision } } },
  })

// the asset list is cached per module, so each test loads a fresh copy alongside the axios it calls
const loadAssets = async () => {
  jest.resetModules()
  const { default: axios } = await import('axios')
  const get = jest.spyOn(axios, 'get')
  const { getAssetPrecisions } = await import('../assets')

  return { get, getAssetPrecisions }
}

// lets a background refresh started by the previous call settle
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('getAssetPrecisions', () => {
  afterEach(() => jest.restoreAllMocks())

  it('loads the asset list once and serves later lookups from memory', async () => {
    const { get, getAssetPrecisions } = await loadAssets()
    get.mockImplementation(assetList('v1', 6))

    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(6)
    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(6)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('throws when the asset list has never loaded, so a caller cannot mistake an outage for an unknown asset', async () => {
    const { get, getAssetPrecisions } = await loadAssets()
    get.mockRejectedValue(new Error('network down'))

    await expect(getAssetPrecisions()).rejects.toThrow('Asset list unavailable')
  })

  it('serves the cached list while a due refresh runs, then the new list once its hash changes', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0)
    const { get, getAssetPrecisions } = await loadAssets()
    get.mockImplementation(assetList('v1', 6))
    await getAssetPrecisions()

    now.mockReturnValue(2 * HOUR)
    get.mockImplementation(assetList('v2', 18))

    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(6)
    await flush()
    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(18)
  })

  it('keeps the cached list when a refresh fails', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0)
    const { get, getAssetPrecisions } = await loadAssets()
    get.mockImplementation(assetList('v1', 6))
    await getAssetPrecisions()

    now.mockReturnValue(2 * HOUR)
    get.mockRejectedValue(new Error('network down'))

    await getAssetPrecisions()
    await flush()
    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(6)
  })
})
