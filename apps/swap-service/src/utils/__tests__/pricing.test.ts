import { Logger } from '@nestjs/common'

import type * as Pricing from '../pricing'

const mockedGet = jest.fn()

jest.mock('axios', () => ({ __esModule: true, default: { get: mockedGet } }))

const { getAssetPriceUsdAt } = jest.requireActual<typeof Pricing>('../pricing')

const ETH = 'eip155:1/slip44:60'
const hour = 60 * 60 * 1000

const at = new Date(Date.UTC(2026, 8, 8, 14, 40, 31))

describe('getAssetPriceUsdAt', () => {
  beforeEach(() => {
    mockedGet.mockReset()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it('prices at the point nearest the swap', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        prices: [
          [at.getTime() - 40 * 60 * 1000, 2400],
          [at.getTime() + 19 * 60 * 1000, 2500],
        ],
      },
    })

    await expect(getAssetPriceUsdAt(ETH, at)).resolves.toBe(2500)
    expect(mockedGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/coins\/ethereum\/market_chart\/range$/),
      expect.objectContaining({
        params: {
          vs_currency: 'usd',
          from: Math.floor((at.getTime() - hour) / 1000),
          to: Math.ceil((at.getTime() + hour) / 1000),
        },
      }),
    )
  })

  it('widens to a day either side when the hour holds no points', async () => {
    mockedGet.mockResolvedValueOnce({ data: { prices: [] } }).mockResolvedValueOnce({
      data: { prices: [[at.getTime() - 3 * hour, 2450]] },
    })

    await expect(getAssetPriceUsdAt(ETH, at)).resolves.toBe(2450)
    expect(mockedGet).toHaveBeenCalledTimes(2)
    const [, config] = mockedGet.mock.calls[1] as [string, { params: { from: number } }]
    expect(config.params.from).toBe(Math.floor((at.getTime() - 24 * hour) / 1000))
  })

  it('returns null rather than a distant price when neither window has data', async () => {
    mockedGet.mockResolvedValue({ data: { prices: [] } })

    await expect(getAssetPriceUsdAt(ETH, at)).resolves.toBeNull()
  })

  it('ignores zero prices', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        prices: [
          [at.getTime(), 0],
          [at.getTime() + 30 * 60 * 1000, 2480],
        ],
      },
    })

    await expect(getAssetPriceUsdAt(ETH, at)).resolves.toBe(2480)
  })

  it('returns null when the request fails', async () => {
    mockedGet.mockRejectedValueOnce(new Error('429'))

    await expect(getAssetPriceUsdAt(ETH, at)).resolves.toBeNull()
  })
})
