import { SwapsService } from '../swaps.service'
import type { Swap } from '../types'

// unchained-client is ESM; ts-jest can't transform it and nothing here uses it.
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

const TX = '0xsharedtx'
const BLOCK_TIME = Math.floor(Date.UTC(2026, 8, 7, 15, 13, 56) / 1000)

type Claim = { swapId: string; quotedAt: Date }

const buildService = (claims: Claim[]) => {
  const updates: { swapId: string; data: Record<string, unknown> }[] = []
  const sweeps: { where: Record<string, unknown>; data: Record<string, unknown> }[] = []

  const prisma = {
    swap: {
      // mirrors the real predicate: an older quote, or the same quote time with a lower swapId
      findFirst: (args: {
        where: { OR: [{ quotedAt: { lt: Date } }, { quotedAt: Date; swapId: { lt: string } }] }
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
        return Promise.resolve({ ...args.data, swapId: args.where.swapId })
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        sweeps.push(args)
        return Promise.resolve({ count: 0 })
      },
    },
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
    blockTime as never,
  )

  return { service, updates, sweeps }
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
      attributionDetails: { checked: true, reason: 'duplicate-claim' },
    })
  })

  // a younger claim can be accepted before its older sibling is even registered
  it('demotes a claim already accepted on the transaction when the oldest arrives', async () => {
    const { service, updates, sweeps } = buildService([first, second])

    await service.resolveAttribution(swapOf(first))

    expect(updates[0]?.data).toMatchObject({ attributionStatus: 'ACCEPTED' })
    expect(sweeps[0]).toMatchObject({
      where: { sellTxHash: TX, swapId: { not: 'first' }, attributionStatus: 'ACCEPTED' },
      data: { attributionStatus: 'DISPUTED', attributionDetails: { reason: 'duplicate-claim' } },
    })
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
})
