import { SwapsService } from '../swaps.service'

// unchained-client is ESM; ts-jest can't transform it and nothing here uses it.
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

const CHAIN = 'eip155:1'
const H1 = `0x${'ab'.repeat(32)}`
const H2 = `0x${'cd'.repeat(32)}`

type Row = Record<string, unknown> & {
  swapId: string
  attributionStatus: string
  acceptedSellTxKey: string | null
}

type ResetWhere = {
  swapId: string
  attributionStatus: string
  OR: [{ acceptedSellTxKey: null }, { acceptedSellTxKey: { not: string } }]
}

// one swap row, with the reset's predicate evaluated as Postgres would (a null key never equals or differs)
const buildService = (initial: Partial<Row>) => {
  const row: Row = {
    swapId: 'swap-1',
    userId: 'api',
    sellAsset: { chainId: CHAIN },
    sellTxHash: H1,
    status: 'PENDING',
    attributionStatus: 'ACCEPTED',
    attributionDetails: { checked: true, reason: 'quote-precedes-tx' },
    attributionResolvedAt: new Date(),
    acceptedSellTxKey: `${CHAIN}:${H1}`,
    ...initial,
  }

  const prisma = {
    $transaction: async (operations: Promise<unknown>[]) => {
      const results: unknown[] = []
      for (const operation of operations) results.push(await operation)
      return results
    },
    swap: {
      findUnique: () => Promise.resolve({ sellAsset: row.sellAsset }),
      findUniqueOrThrow: () => Promise.resolve({ ...row }),
      update: (args: { data: Record<string, unknown> }) => {
        Object.assign(row, args.data)
        return Promise.resolve({ ...row })
      },
      updateMany: (args: { where: ResetWhere; data: Record<string, unknown> }) => {
        const [, differs] = args.where.OR
        const matches =
          row.attributionStatus === args.where.attributionStatus &&
          (row.acceptedSellTxKey === null || row.acceptedSellTxKey !== differs.acceptedSellTxKey.not)
        if (matches) Object.assign(row, args.data)
        return Promise.resolve({ count: matches ? 1 : 0 })
      },
    },
  }

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
    stub,
    stub,
  )

  return { service, row }
}

const reopened = {
  attributionStatus: 'PENDING',
  attributionDetails: { checked: false, reason: 'sell-tx-changed' },
  attributionResolvedAt: null,
  acceptedSellTxKey: null,
}

describe('sell transaction change on an accepted claim', () => {
  it('reopens the claim when the poller reports a different transaction', async () => {
    const { service, row } = buildService({})

    const swap = await service.updateSwapTxHashes({ swapId: 'swap-1', sellTxHash: H2 })

    expect(row).toMatchObject({ sellTxHash: H2, ...reopened })
    expect(swap).toMatchObject({ sellTxHash: H2, attributionStatus: 'PENDING', acceptedSellTxKey: null })
  })

  it('reopens the claim when the transaction changes along with the status', async () => {
    const { service, row } = buildService({})

    await service.updateSwapStatus({ swapId: 'swap-1', status: 'SUCCESS', sellTxHash: H2 })

    expect(row).toMatchObject({ status: 'SUCCESS', sellTxHash: H2, ...reopened })
  })

  it('keeps the claim when the same transaction is reported in another spelling', async () => {
    const { service, row } = buildService({})

    await service.updateSwapTxHashes({ swapId: 'swap-1', sellTxHash: H1.toUpperCase().replace(/^0X/, '0x') })

    expect(row).toMatchObject({
      sellTxHash: H1,
      attributionStatus: 'ACCEPTED',
      acceptedSellTxKey: `${CHAIN}:${H1}`,
    })
  })

  it('keeps the claim when no sell transaction is reported', async () => {
    const { service, row } = buildService({})

    await service.updateSwapTxHashes({ swapId: 'swap-1', buyTxHash: '0xbuy' })

    expect(row).toMatchObject({ attributionStatus: 'ACCEPTED', acceptedSellTxKey: `${CHAIN}:${H1}` })
  })

  it('leaves a claim that was not accepted as it was', async () => {
    const details = { checked: true, reason: 'quote-superseded' }
    const { service, row } = buildService({
      attributionStatus: 'DISPUTED',
      attributionDetails: details,
      acceptedSellTxKey: null,
    })

    await service.updateSwapTxHashes({ swapId: 'swap-1', sellTxHash: H2 })

    expect(row).toMatchObject({ sellTxHash: H2, attributionStatus: 'DISPUTED', attributionDetails: details })
  })
})
