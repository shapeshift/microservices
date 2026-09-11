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
    Chainflip: {
      supportsExternalPayment: true,
      checkTradeStatus: (...args: unknown[]): unknown => checkTradeStatus(...args),
    },
    'NEAR Intents': {
      supportsExternalPayment: true,
      checkTradeStatus: (...args: unknown[]): unknown => checkTradeStatus(...args),
    },
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
  swapperName: 'NEAR Intents',
  sellAsset: asset,
  buyAsset: asset,
  sellTxHash: null,
  buyTxHash: null,
  sellAccountId: 'eip155:1:0xsender',
  metadata: { stepIndex: 0, swapperMetadata: { name: 'nearIntents', depositAddress: 'deposit' } },
  createdAt: new Date(),
  updatedAt: new Date(),
  affiliateVerificationDetails: null,
  ...overrides,
})

const buildService = (swap: ReturnType<typeof row>, onChainTxHash: string | undefined) => {
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
  const depositDetection = { findDepositOnChain: jest.fn().mockResolvedValue(onChainTxHash) }

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

const pending = { status: 'Pending', buyTxHash: undefined, message: 'Waiting for deposit...' }

describe('checkSwapStatus', () => {
  beforeEach(() => {
    checkTradeStatus.mockReset()
  })

  it('still rejects a wallet-signed swap that has no sell tx hash', async () => {
    const { service, depositDetection } = buildService(row({ swapperName: 'Relay' as never }), undefined)

    await expect(service.checkSwapStatus('swap-1')).rejects.toThrow('Sell tx hash is required')

    expect(depositDetection.findDepositOnChain).not.toHaveBeenCalled()
    expect(checkTradeStatus).not.toHaveBeenCalled()
  })

  it('polls the provider for an externally paid swap before any deposit is seen', async () => {
    checkTradeStatus.mockResolvedValue(pending)
    const { service } = buildService(row(), undefined)

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'PENDING',
      statusMessage: 'Waiting for deposit...',
      sellTxHash: undefined,
      buyTxHash: undefined,
      txLink: undefined,
    })

    expect(checkTradeStatus).toHaveBeenCalledWith(expect.objectContaining({ txHash: '' }))
  })

  it('takes the deposit hash and tracker link the provider reports', async () => {
    checkTradeStatus.mockResolvedValue({
      ...pending,
      sellTxHash: 'nearhash',
      swapperTxLink: 'https://explorer.near-intents.org/transactions/deposit',
      message: 'Processing swap...',
    })
    const { service, depositDetection } = buildService(row(), undefined)

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'PENDING',
      statusMessage: 'Processing swap...',
      sellTxHash: 'nearhash',
      buyTxHash: undefined,
      txLink: 'https://explorer.near-intents.org/transactions/deposit',
    })

    expect(depositDetection.findDepositOnChain).not.toHaveBeenCalled()
  })

  it('falls back to the chain when the provider settles without reporting a deposit', async () => {
    checkTradeStatus.mockResolvedValue({ status: 'Confirmed', buyTxHash: '0xbuy', message: undefined })
    const { service, depositDetection } = buildService(row(), 'f85da1de')

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'SUCCESS',
      statusMessage: '',
      sellTxHash: 'f85da1de',
      buyTxHash: '0xbuy',
      txLink: undefined,
    })

    expect(depositDetection.findDepositOnChain).toHaveBeenCalledTimes(1)
  })

  it('abandons an externally paid swap that was never funded', async () => {
    checkTradeStatus.mockResolvedValue(pending)
    const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const { service } = buildService(row({ createdAt }), undefined)

    const result = await service.checkSwapStatus('swap-1')

    expect(result.status).toBe('FAILED')
    expect(result.statusMessage).toContain('Waiting for deposit...')
  })

  it('polls with the known sell tx hash and never scans', async () => {
    checkTradeStatus.mockResolvedValue({ status: 'Confirmed', buyTxHash: '0xbuy', message: undefined })
    const { service, depositDetection } = buildService(row({ sellTxHash: '0xsell' }), undefined)

    await expect(service.checkSwapStatus('swap-1')).resolves.toEqual({
      status: 'SUCCESS',
      statusMessage: '',
      sellTxHash: '0xsell',
      buyTxHash: '0xbuy',
      txLink: undefined,
    })

    expect(depositDetection.findDepositOnChain).not.toHaveBeenCalled()
    expect(checkTradeStatus).toHaveBeenCalledWith(expect.objectContaining({ txHash: '0xsell' }))
  })
})

describe('getPendingTxSwaps', () => {
  it('includes externally paid swaps that have no sell tx hash yet', async () => {
    const { service, findManyCalls } = buildService(row(), undefined)

    await service.getPendingTxSwaps()

    expect(findManyCalls[0]).toEqual({
      where: {
        OR: [
          { status: { in: ['IDLE', 'PENDING'] }, sellTxHash: { not: null } },
          { status: { in: ['IDLE', 'PENDING'] }, swapperName: { in: ['Chainflip', 'NEAR Intents'] } },
          {
            status: { in: ['SUCCESS', 'FAILED'] },
            sellTxHash: null,
            swapperName: { in: ['Chainflip', 'NEAR Intents'] },
            createdAt: { gt: expect.any(Date) as unknown as Date },
          },
        ],
      },
    })
  })
})
