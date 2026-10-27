import { SwapsService } from '../swaps.service'
import type { Swap } from '../types'
import { getExternalPaymentSwappers } from '../utils'

// unchained-client is ESM; ts-jest can't transform it and nothing here uses it.
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

const DAY = 24 * 60 * 60 * 1000

const buildService = (verifierResult: Record<string, unknown> = {}) => {
  const updates: { swapId: string; data: Record<string, unknown> }[] = []
  const lookups: string[] = []

  const prisma = {
    swap: {
      update: (args: { where: { swapId: string }; data: Record<string, unknown> }) => {
        updates.push({ swapId: args.where.swapId, data: args.data })
        return Promise.resolve({ ...args.data, swapId: args.where.swapId })
      },
    },
  }

  const verification = {
    verifySwap: () => Promise.resolve({ hasAffiliate: false, ...verifierResult }),
  }

  const blockTime = {
    lookup: (_chainId: string, txHash: string) => {
      lookups.push(txHash)
      return Promise.resolve({ unavailable: 'error' })
    },
  }

  const stub = {} as never
  const service = new SwapsService(
    prisma as never,
    verification as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    blockTime as never,
    stub,
  )

  return { service, updates, lookups }
}

const swapOf = (overrides: Partial<Swap> = {}): Swap =>
  ({
    swapId: 'swap-1',
    sellTxHash: '0xtx',
    sellAsset: { chainId: 'eip155:1' },
    quotedAt: new Date(Date.now() - 9 * DAY),
    status: 'SUCCESS',
    createdAt: new Date(),
    settledAt: null,
    attributionStatus: 'PENDING',
    attributionDetails: null,
    verificationStatus: 'PENDING',
    ...overrides,
  }) as unknown as Swap

describe('verification deadline', () => {
  const pending = { verificationStatus: 'PENDING', noAffiliateReason: 'No request data returned from Relay API' }

  it('keeps retrying a verifier that cannot answer yet', async () => {
    const { service, updates } = buildService(pending)

    await service.verifySwap(swapOf({ createdAt: new Date(Date.now() - 6 * DAY) }))

    expect(updates).toEqual([])
  })

  it('fails verification once the deadline passes, recording why', async () => {
    const { service, updates } = buildService(pending)

    await service.verifySwap(swapOf({ createdAt: new Date(Date.now() - 8 * DAY) }))

    expect(updates).toEqual([
      {
        swapId: 'swap-1',
        data: {
          verificationStatus: 'FAILED',
          isAffiliateVerified: false,
          affiliateVerificationDetails: {
            hasAffiliate: false,
            reason: 'timeout: No request data returned from Relay API',
          },
        },
      },
    ])
  })

  it('counts the verification deadline from settlement', async () => {
    const { service, updates } = buildService(pending)

    await service.verifySwap(
      swapOf({ createdAt: new Date(Date.now() - 10 * DAY), settledAt: new Date(Date.now() - 2 * DAY) }),
    )

    expect(updates).toEqual([])
  })
})

describe('attribution for a swap with no transaction', () => {
  it('rejects a failed swap that never had a transaction, without a chain lookup', async () => {
    const { service, updates, lookups } = buildService()

    await service.resolveAttribution(swapOf({ sellTxHash: null, quotedAt: null, status: 'FAILED' }))

    expect(lookups).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      swapId: 'swap-1',
      data: { attributionStatus: 'REJECTED', attributionDetails: { checked: false, reason: 'no-tx' } },
    })
  })

  it('leaves a live swap without a transaction alone', async () => {
    const { service, updates } = buildService()

    await service.resolveAttribution(swapOf({ sellTxHash: null, status: 'PENDING' }))

    expect(updates).toEqual([])
  })
})

describe('polling queries and writes', () => {
  const build = (prisma: Record<string, unknown>) => {
    const stub = {} as never
    return new SwapsService(
      { swap: prisma } as never,
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
      stub,
    )
  }

  it('writes each price only into a field still empty, and the fee price only for its asset', async () => {
    const writes: { where: Record<string, unknown>; data: Record<string, unknown> }[] = []
    const service = build({
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        writes.push(args)
        return Promise.resolve({ count: 1 })
      },
    })

    const swap = swapOf({
      createdAt: new Date(),
      sellAsset: { assetId: 'eip155:1/slip44:60', chainId: 'eip155:1' },
      buyAsset: { assetId: 'eip155:1/erc20:0xusdc' },
      affiliateFeeAssetId: 'eip155:8453/slip44:60',
      sellAssetUsd: null,
      buyAssetUsd: '1',
      affiliateAssetUsd: null,
    } as unknown as Partial<Swap>)

    const pricing = jest.requireMock<{ getAssetPriceUsdAt: jest.Mock }>('../../utils/pricing')
    pricing.getAssetPriceUsdAt.mockResolvedValue(2500)

    await expect(service.fillMissingPrices(swap)).resolves.toBe(2)
    expect(writes).toEqual([
      { where: { swapId: 'swap-1', sellAssetUsd: null }, data: { sellAssetUsd: '2500' } },
      {
        where: { swapId: 'swap-1', affiliateAssetUsd: null, affiliateFeeAssetId: 'eip155:8453/slip44:60' },
        data: { affiliateAssetUsd: '2500' },
      },
    ])
  })

  it('takes the newest pending attribution and the claims past their deadline, once each', async () => {
    const queries: Record<'asc' | 'desc', { where: Record<string, unknown>; take: number }> = {} as never
    const service = build({
      findMany: (args: { where: Record<string, unknown>; orderBy: { createdAt: 'asc' | 'desc' }; take: number }) => {
        queries[args.orderBy.createdAt] = { where: args.where, take: args.take }
        return Promise.resolve(
          args.orderBy.createdAt === 'desc'
            ? [{ swapId: 'new-1' }, { swapId: 'mid' }]
            : [{ swapId: 'old-1' }, { swapId: 'mid' }],
        )
      },
    })

    const swaps = await service.getPendingAttributionSwaps()

    expect(swaps.map((swap) => swap.swapId)).toEqual(['new-1', 'mid', 'old-1'])
    expect(queries.desc.take + queries.asc.take).toBe(200)
    expect(queries.desc.where).toMatchObject({
      OR: [
        { sellTxHash: { not: null }, quotedAt: { not: null } },
        { sellTxHash: null, status: 'FAILED' },
      ],
    })
    expect(queries.asc.where).toMatchObject({ attributionStatus: 'PENDING', status: { in: ['SUCCESS', 'FAILED'] } })
    expect(queries.asc.where).not.toHaveProperty('sellTxHash')
    const [settled, unsettled] = queries.asc.where.OR as [{ settledAt: { lt: Date } }, { createdAt: { lt: Date } }]
    expect(Date.now() - settled.settledAt.lt.getTime()).toBeGreaterThanOrEqual(7 * DAY - 1000)
    expect(Date.now() - unsettled.createdAt.lt.getTime()).toBeGreaterThanOrEqual(7 * DAY - 1000)
  })

  it('abandons non-deposit swaps that never reported a transaction for 24h', async () => {
    const finds: Record<string, unknown>[] = []
    let write: { where: Record<string, unknown>; data: Record<string, unknown> } | undefined
    const service = build({
      findMany: (args: { where: Record<string, unknown> }) => {
        finds.push(args.where)
        return Promise.resolve(
          finds.length === 1 ? [{ swapId: 'stalled-1' }, { swapId: 'stalled-2' }] : [{ swapId: 'stalled-1' }],
        )
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        write = args
        return Promise.resolve({ count: 1 })
      },
    })

    const abandoned = await service.abandonUnbroadcastSwaps()

    expect(finds[0]).toMatchObject({
      status: { in: ['IDLE', 'PENDING'] },
      sellTxHash: null,
      swapperName: { notIn: getExternalPaymentSwappers() },
    })
    expect(Date.now() - (finds[0].createdAt as { lt: Date }).lt.getTime()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000 - 1000,
    )
    expect(write?.where).toMatchObject({ ...finds[0], swapId: { in: ['stalled-1', 'stalled-2'] } })
    expect(write?.data).toMatchObject({ status: 'FAILED', settledAt: expect.any(Date) as Date })
    // the re-read only finds rows the guarded write actually moved
    expect(abandoned.map((swap) => swap.swapId)).toEqual(['stalled-1'])
  })

  it('stamps settledAt when a swap settles, and only then', async () => {
    const writes: Record<string, unknown>[] = []
    const service = build({
      update: (args: { where: { swapId: string }; data: Record<string, unknown> }) => {
        writes.push(args.data)
        return Promise.resolve({ ...args.data, swapId: args.where.swapId })
      },
    })
    jest
      .spyOn(
        service as unknown as { sendStatusUpdateNotification: () => Promise<void> },
        'sendStatusUpdateNotification',
      )
      .mockResolvedValue()

    await service.updateSwapStatus({ swapId: 'swap-1', status: 'SUCCESS' })
    await service.updateSwapStatus({ swapId: 'swap-1', status: 'PENDING' })

    expect(writes[0].settledAt).toBeInstanceOf(Date)
    expect(writes[1]).not.toHaveProperty('settledAt')
  })
})
