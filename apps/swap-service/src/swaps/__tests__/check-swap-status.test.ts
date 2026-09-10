import { SwapsService } from '../swaps.service'
import type { Swap } from '../types'

const checkTradeStatus = jest.fn()

jest.mock('@shapeshiftoss/unchained-client', () => ({
  TxStatus: { Confirmed: 'Confirmed', Failed: 'Failed', Pending: 'Pending', Unknown: 'Unknown' },
}))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

jest.mock('@shapeshiftoss/swapper', () => ({
  SwapperName: { Chainflip: 'Chainflip', NearIntents: 'NEAR Intents', Relay: 'Relay' },
  swappers: {
    Chainflip: { checkTradeStatus: (...args: unknown[]): unknown => checkTradeStatus(...args) },
    'NEAR Intents': { checkTradeStatus: (...args: unknown[]): unknown => checkTradeStatus(...args) },
    Relay: { checkTradeStatus: (...args: unknown[]): unknown => checkTradeStatus(...args) },
  },
}))

jest.mock('../swapper-config', () => ({
  getSwapperConfig: () => ({}),
  buildChainAdapterAsserts: () => ({}),
}))

process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

const asset = { assetId: 'eip155:1/slip44:60', chainId: 'eip155:1', symbol: 'ETH', name: 'Ethereum', precision: 18 }

const row = (overrides: Partial<Swap> = {}) => ({
  swapId: 'swap-1',
  status: 'PENDING',
  swapperName: 'Chainflip',
  sellAsset: asset,
  buyAsset: asset,
  sellTxHash: null,
  buyTxHash: null,
  sellAccountId: 'eip155:1:0xsender',
  metadata: { stepIndex: 0, swapperMetadata: { name: 'chainflip', swapId: 1 } },
  createdAt: new Date(),
  updatedAt: new Date(),
  affiliateVerificationDetails: null,
  ...overrides,
})

const buildService = (swap: ReturnType<typeof row>, depositTxHash: string | undefined) => {
  const findManyCalls: Record<string, unknown>[] = []
  const prisma = {
    swap: {
      findUnique: () => Promise.resolve(swap),
      findMany: (args: Record<string, unknown>) => {
        findManyCalls.push(args)
        return Promise.resolve([])
      },
    },
  }
  const depositDetection = { findDepositTxHash: jest.fn().mockResolvedValue(depositTxHash) }

  const stub = {} as never
  const service = new SwapsService(
    prisma as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    depositDetection as never,
  )

  return { service, depositDetection, findManyCalls }
}

describe('checkSwapStatus', () => {
  beforeEach(() => {
    checkTradeStatus.mockReset()
  })

  it('still rejects a wallet-signed swap that has no sell tx hash', async () => {
    const { service, depositDetection } = buildService(row({ swapperName: 'Relay' as never }), undefined)

    await expect(service.checkSwapStatus('swap-1')).rejects.toThrow('Sell tx hash is required')

    expect(depositDetection.findDepositTxHash).not.toHaveBeenCalled()
    expect(checkTradeStatus).not.toHaveBeenCalled()
  })

  it('reports an externally paid swap as awaiting its deposit until the provider sees one', async () => {
    const { service } = buildService(row(), undefined)

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'PENDING',
      statusMessage: 'Awaiting deposit',
      sellTxHash: undefined,
    })

    expect(checkTradeStatus).not.toHaveBeenCalled()
  })

  it('returns the deposit tx hash the provider reports, still pending', async () => {
    const { service } = buildService(row({ swapperName: 'NEAR Intents' as never }), 'nearhash')

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'PENDING',
      statusMessage: 'Deposit detected',
      sellTxHash: 'nearhash',
    })
  })

  it('abandons an externally paid swap that was never funded', async () => {
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const { service } = buildService(row({ createdAt }), undefined)

    const result = await service.checkSwapStatus('swap-1')

    expect(result.status).toBe('FAILED')
    expect(result.statusMessage).toContain('Awaiting deposit')
  })

  it('polls the swapper once a sell tx hash is known', async () => {
    checkTradeStatus.mockResolvedValue({ status: 'Confirmed', buyTxHash: '0xbuy', message: undefined })
    const { service, depositDetection } = buildService(row({ sellTxHash: '0xsell' }), undefined)

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'SUCCESS',
      statusMessage: '',
      sellTxHash: '0xsell',
      buyTxHash: '0xbuy',
    })

    expect(depositDetection.findDepositTxHash).not.toHaveBeenCalled()
    expect(checkTradeStatus).toHaveBeenCalledWith(expect.objectContaining({ txHash: '0xsell' }))
  })
})

describe('getPendingTxSwaps', () => {
  it('includes externally paid swaps that have no sell tx hash yet', async () => {
    const { service, findManyCalls } = buildService(row(), undefined)

    await service.getPendingTxSwaps()

    expect(findManyCalls[0]).toEqual({
      where: {
        status: { in: ['IDLE', 'PENDING'] },
        OR: [{ sellTxHash: { not: null } }, { swapperName: { in: ['Chainflip', 'NEAR Intents'] } }],
      },
    })
  })
})
