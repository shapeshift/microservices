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

  // closed out unverified, and the reason survives for the payout report
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

  // a deposit funded days in still gets a full week to verify
  it('counts the verification deadline from settlement', async () => {
    const { service, updates } = buildService(pending)

    await service.verifySwap(
      swapOf({ createdAt: new Date(Date.now() - 10 * DAY), settledAt: new Date(Date.now() - 2 * DAY) }),
    )

    expect(updates).toEqual([])
  })

  it('never times out a verifier that answered', async () => {
    const { service, updates } = buildService({ verificationStatus: 'SUCCESS', hasAffiliate: true, affiliateBps: 30 })

    await service.verifySwap(swapOf({ createdAt: new Date(Date.now() - 30 * DAY) }))

    expect(updates[0].data).toMatchObject({ verificationStatus: 'SUCCESS', isAffiliateVerified: true })
  })
})

describe('attribution for a swap with no transaction', () => {
  // e.g. a deposit-address swap the user never funded
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

  // a deposit may still arrive, so only a failed swap is closed
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

  // verification may record a different fee asset meanwhile, which a stale price must not land on
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

  // a backlog of unresolvable rows must not starve either end: new swaps, or old ones due their deadline
  it('takes both the newest and the oldest pending attribution, once each', async () => {
    const service = build({
      findMany: (args: { orderBy: { createdAt: 'asc' | 'desc' }; take: number }) =>
        Promise.resolve(
          args.orderBy.createdAt === 'desc'
            ? [{ swapId: 'new-1' }, { swapId: 'mid' }]
            : [{ swapId: 'old-1' }, { swapId: 'mid' }],
        ),
    })

    const swaps = await service.getPendingAttributionSwaps()

    expect(swaps.map((swap) => swap.swapId)).toEqual(['new-1', 'mid', 'old-1'])
  })

  it('abandons only unfunded swaps that never reported a transaction for 24h', async () => {
    let where: Record<string, unknown> = {}
    const service = build({
      updateMany: (args: { where: Record<string, unknown> }) => {
        where = args.where
        return Promise.resolve({ count: 3 })
      },
    })

    await expect(service.abandonUnbroadcastSwaps()).resolves.toBe(3)
    expect(where).toMatchObject({
      status: { in: ['IDLE', 'PENDING'] },
      sellTxHash: null,
      swapperName: { notIn: getExternalPaymentSwappers() },
    })
    expect(Date.now() - (where.createdAt as { lt: Date }).lt.getTime()).toBeGreaterThanOrEqual(
      24 * 60 * 60 * 1000 - 1000,
    )
  })
})
