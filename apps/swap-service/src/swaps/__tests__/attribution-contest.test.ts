import { Prisma } from '@shapeshift/prisma'

import { SwapsService } from '../swaps.service'
import type { Swap } from '../types'

// unchained-client is ESM; ts-jest can't transform it and nothing here uses it.
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

const TX = '0x5badc0ffee'
const BLOCK_TIME = Math.floor(Date.UTC(2026, 8, 7, 15, 13, 56) / 1000)

type Claim = { swapId: string; quotedAt: Date }

const buildService = (
  claims: Claim[],
  { failAcceptWith, storedSellTxHash = TX }: { failAcceptWith?: Error; storedSellTxHash?: string } = {},
) => {
  const updates: { swapId: string; data: Record<string, unknown> }[] = []
  const sweeps: { where: Record<string, unknown>; data: Record<string, unknown> }[] = []

  // every field written to a swap, in order
  const written = (swapId: string): Record<string, unknown> =>
    Object.assign({}, ...updates.filter((u) => u.swapId === swapId).map((u) => u.data)) as Record<string, unknown>

  const swap = {
    // mirrors the real predicate: an older quote, or the same quote time with a lower swapId
    findFirst: (args: {
      where: {
        sellAsset: { path: string[]; equals: string }
        OR: [{ quotedAt: { lt: Date } }, { quotedAt: Date; swapId: { lt: string } }]
      }
    }): Promise<{ swapId: string } | null> => {
      const [older, tied] = args.where.OR
      const claim = claims.find(
        (c) =>
          c.quotedAt < older.quotedAt.lt ||
          (c.quotedAt.getTime() === tied.quotedAt.getTime() && c.swapId < tied.swapId.lt),
      )
      return Promise.resolve(claim ? { swapId: claim.swapId } : null)
    },
    update: (args: { where: { swapId: string }; data: Record<string, unknown> }) => {
      updates.push({ swapId: args.where.swapId, data: args.data })
      return Promise.resolve({ ...written(args.where.swapId), swapId: args.where.swapId })
    },
    // a write to this swap is conditional on the hash it still holds; any other is the sweep of rival claims
    updateMany: (args: { where: { swapId: unknown; sellTxHash?: string }; data: Record<string, unknown> }) => {
      if (typeof args.where.swapId !== 'string') {
        sweeps.push(args)
        return Promise.resolve({ count: 0 })
      }
      if (args.where.sellTxHash !== storedSellTxHash) return Promise.resolve({ count: 0 })
      updates.push({ swapId: args.where.swapId, data: args.data })
      return Promise.resolve({ count: 1 })
    },
  }

  const prisma = {
    $transaction: (run: (tx: { swap: typeof swap }) => Promise<unknown>) =>
      failAcceptWith ? Promise.reject(failAcceptWith) : run({ swap }),
    swap,
  }

  const blockTime = { lookup: () => Promise.resolve({ blockTime: BLOCK_TIME }) }
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
    blockTime as never,
    stub,
  )

  return { service, updates, sweeps, written }
}

const swapOf = (claim: Claim): Swap =>
  ({
    swapId: claim.swapId,
    sellTxHash: TX,
    sellAsset: { chainId: 'eip155:1' },
    quotedAt: claim.quotedAt,
    status: 'SUCCESS',
    createdAt: claim.quotedAt,
    attributionStatus: 'PENDING',
    attributionDetails: null,
  }) as unknown as Swap

describe('resolveAttribution contest', () => {
  const first = { swapId: 'first', quotedAt: new Date(Date.UTC(2026, 8, 7, 14, 14, 57)) }
  const second = { swapId: 'second', quotedAt: new Date(Date.UTC(2026, 8, 7, 14, 26, 12)) }

  // both quotes precede the block, so binding accepts each one on its own
  it('accepts the oldest claim on a transaction', async () => {
    const { service, updates } = buildService([first, second])

    await service.resolveAttribution(swapOf(first))

    expect(updates[0]?.data).toMatchObject({
      attributionStatus: 'ACCEPTED',
      attributionDetails: { reason: 'quote-precedes-tx' },
    })
  })

  it('disputes a later claim on a transaction another quote already holds', async () => {
    const { service, updates } = buildService([first, second])

    await service.resolveAttribution(swapOf(second))

    expect(updates[0]?.data).toMatchObject({
      attributionStatus: 'DISPUTED',
      attributionDetails: { checked: true, reason: 'quote-superseded' },
    })
  })

  // a younger claim can be accepted before its older sibling is even registered
  it('demotes a claim already accepted on the transaction when the oldest arrives', async () => {
    const { service, updates, sweeps } = buildService([first, second])

    await service.resolveAttribution(swapOf(first))

    expect(updates[0]?.data).toMatchObject({ attributionStatus: 'ACCEPTED' })
    expect(sweeps[0]).toMatchObject({
      where: {
        swapId: { not: 'first' },
        attributionStatus: 'ACCEPTED',
        OR: [{ sellTxHash: TX }, { acceptedSellTxKey: `eip155:1:${TX}` }],
      },
      data: {
        attributionStatus: 'DISPUTED',
        attributionDetails: { reason: 'quote-superseded' },
        acceptedSellTxKey: null,
      },
    })
  })

  it('holds the transaction key while the claim is accepted, so no other swap can be accepted on it', async () => {
    const { service, written } = buildService([first])

    await service.resolveAttribution(swapOf(first))

    expect(written('first')).toMatchObject({ attributionStatus: 'ACCEPTED', acceptedSellTxKey: `eip155:1:${TX}` })
  })

  it('leaves the claim pending when another is accepted on the transaction at the same time', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    })
    const { service } = buildService([first], { failAcceptWith: conflict })

    const swap = swapOf(first)

    await expect(service.resolveAttribution(swap)).resolves.toBe(swap)
  })

  it('does not hold a key for a claim that is not accepted', async () => {
    const { service, updates } = buildService([first, second])

    await service.resolveAttribution(swapOf(second))

    expect(updates[0]?.data).not.toHaveProperty('acceptedSellTxKey')
  })

  it('leaves other claims alone when this one loses', async () => {
    const { service, sweeps } = buildService([first, second])

    await service.resolveAttribution(swapOf(second))

    expect(sweeps).toHaveLength(0)
  })

  it('accepts an uncontested claim', async () => {
    const { service, updates } = buildService([second])

    await service.resolveAttribution(swapOf(second))

    expect(updates[0]?.data).toMatchObject({ attributionStatus: 'ACCEPTED' })
  })

  // the poller can replace the hash while the chain check for the old one is in flight
  it('takes the claim only while the swap still holds the transaction that was checked', async () => {
    const { service, updates } = buildService([first])

    await service.resolveAttribution(swapOf(first))

    expect(updates[0]?.data).toMatchObject({ attributionStatus: 'ACCEPTED' })
    expect(updates[0]?.data).not.toHaveProperty('acceptedSellTxKey')
  })

  it('leaves the claim pending, and other claims alone, when the swap moved to another transaction', async () => {
    const { service, updates, sweeps } = buildService([first], { storedSellTxHash: '0xfeebdaed' })

    const swap = swapOf(first)

    await expect(service.resolveAttribution(swap)).resolves.toBe(swap)
    expect(updates).toHaveLength(0)
    expect(sweeps).toHaveLength(0)
  })
})
