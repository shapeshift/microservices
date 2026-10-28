const BASE_USDC = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

const assetList = (url: string) =>
  Promise.resolve({
    data: url.includes('asset-manifest')
      ? { assetData: 'abc123' }
      : { byId: { [BASE_USDC]: { assetId: BASE_USDC, precision: 6 } } },
  })

// the asset list is cached per module, so each test loads a fresh copy alongside the axios it calls
const loadAssets = async () => {
  jest.resetModules()
  const { default: axios } = await import('axios')
  const get = jest.spyOn(axios, 'get')
  const { getAssetPrecisions } = await import('../assets')

  return { get, getAssetPrecisions }
}

describe('getAssetPrecisions', () => {
  it('loads the asset list once and serves later lookups from memory', async () => {
    const { get, getAssetPrecisions } = await loadAssets()
    get.mockImplementation(assetList)

    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(6)
    expect((await getAssetPrecisions()).get(BASE_USDC)).toBe(6)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('throws when the asset list has never loaded, so a caller cannot mistake an outage for an unknown asset', async () => {
    const { get, getAssetPrecisions } = await loadAssets()
    get.mockRejectedValue(new Error('network down'))

    await expect(getAssetPrecisions()).rejects.toThrow('Asset list unavailable')
  })
})
