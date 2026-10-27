import { SwapsService } from '../swaps.service'
import type { Swap } from '../types'

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
    expect(updates).toEqual([
      {
        swapId: 'swap-1',
        data: expect.objectContaining({
          attributionStatus: 'REJECTED',
          attributionDetails: { checked: false, reason: 'no-tx' },
        }),
      },
    ])
  })

  // a deposit may still arrive, so only a failed swap is closed
  it('leaves a live swap without a transaction alone', async () => {
    const { service, updates } = buildService()

    await service.resolveAttribution(swapOf({ sellTxHash: null, status: 'PENDING' }))

    expect(updates).toEqual([])
  })
})
