import type { CreateSwapDto } from '@shapeshift/shared-types'

import { SwapsService } from '../swaps.service'

// unchained-client is ESM; ts-jest can't transform it and nothing here uses it.
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

// The constructor eagerly builds HTTP clients that require these.
process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

type AffiliateRow = {
  partnerCode: string
  receiveAddress: string | null
  walletAddress: string
  isActive: boolean
}

type FindUniqueArgs = { where?: { partnerCode?: string } }
type FindManyArgs = { where?: { isActive?: boolean } }
type CreateArgs = { data: Record<string, unknown> }

const asset = {
  assetId: 'eip155:1/slip44:60',
  chainId: 'eip155:1',
  symbol: 'ETH',
  name: 'Ethereum',
  precision: 18,
}

// No userId: getReferralCode short-circuits, so the user-service client stays out.
const swapRequest = (overrides: Partial<CreateSwapDto> = {}): CreateSwapDto =>
  ({
    swapId: 'swap-1',
    sellAsset: asset,
    buyAsset: { ...asset, assetId: 'eip155:1/erc20:0xusdc', symbol: 'USDC', precision: 6 },
    sellAmountCryptoBaseUnit: '1000000000000000000',
    expectedBuyAmountCryptoBaseUnit: '3000000000',
    source: 'test',
    swapperName: 'Relay',
    sellAccountId: 'eip155:1:0xsender',
    buyAccountId: 'eip155:1:0xreceiver',
    receiveAddress: '0xreceiver',
    affiliateBps: 40,
    shapeshiftBps: 10,
    partnerBps: 30,
    ...overrides,
  }) as CreateSwapDto

const buildService = (affiliate: AffiliateRow | null, addressMatches: { partnerCode: string }[] = []) => {
  const findUniqueCalls: FindUniqueArgs[] = []
  const findManyCalls: FindManyArgs[] = []
  const createCalls: CreateArgs[] = []

  const prisma = {
    affiliate: {
      findUnique: (args: FindUniqueArgs): Promise<AffiliateRow | null> => {
        findUniqueCalls.push(args)
        return Promise.resolve(affiliate)
      },
      findMany: (args: FindManyArgs): Promise<{ partnerCode: string }[]> => {
        findManyCalls.push(args)
        return Promise.resolve(addressMatches)
      },
    },
    swap: {
      // echoed back for toSwap to spread; assertions read createCalls
      create: (args: CreateArgs): Promise<Record<string, unknown>> => {
        createCalls.push(args)
        return Promise.resolve({ ...args.data, createdAt: new Date(0), updatedAt: new Date(0) })
      },
    },
  }

  const stub = {} as never
  const service = new SwapsService(prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub)

  return { service, findUniqueCalls, findManyCalls, createCalls }
}

const activeAffiliate: AffiliateRow = {
  partnerCode: 'acme',
  receiveAddress: '0xreceive',
  walletAddress: '0xwallet',
  isActive: true,
}

const deactivatedAffiliate: AffiliateRow = {
  partnerCode: 'inactive-partner',
  receiveAddress: '0xreceive',
  walletAddress: '0xwallet',
  isActive: false,
}

describe('createSwap partner attribution', () => {
  it('persists attribution for an active partner, resolved from the registry', async () => {
    const { service, createCalls, findUniqueCalls } = buildService(activeAffiliate)

    await service.createSwap(swapRequest({ partnerCode: 'acme' }))

    // partnerAddress comes from the registry, never the caller
    expect(createCalls[0]?.data).toMatchObject({ partnerCode: 'acme', partnerAddress: '0xreceive' })
    expect(findUniqueCalls[0]?.where?.partnerCode).toBe('acme')
  })

  it('persists a deactivated partner’s swap with no attribution', async () => {
    const { service, createCalls } = buildService(deactivatedAffiliate)

    await service.createSwap(swapRequest({ partnerCode: 'inactive-partner' }))

    expect(createCalls[0]?.data).toMatchObject({ partnerCode: null, partnerAddress: null })
  })

  it('never attributes a swap that names no partner', async () => {
    const { service, createCalls, findUniqueCalls, findManyCalls } = buildService(null)

    await service.createSwap(swapRequest())

    expect(createCalls[0]?.data).toMatchObject({ partnerCode: null, partnerAddress: null })
    expect(findUniqueCalls).toHaveLength(0)
    expect(findManyCalls).toHaveLength(0)
  })

  // Postgres does the filtering; this only asserts the filter was requested.
  it('requests only active affiliates when resolving by partner address', async () => {
    const { service, findManyCalls } = buildService(null, [{ partnerCode: 'acme' }])

    await service.createSwap(swapRequest({ partnerAddress: '0xwallet' }))

    expect(findManyCalls[0]?.where?.isActive).toBe(true)
  })
})

describe('createSwap quote provenance', () => {
  it('persists the quote mint time carried by the registration payload', async () => {
    const { service, createCalls } = buildService(null)

    await service.createSwap(swapRequest({ quotedAt: '2026-09-01T12:00:00.000Z' }))

    expect(createCalls[0]?.data).toMatchObject({
      quotedAt: new Date('2026-09-01T12:00:00.000Z'),
    })
  })

  // null rather than a default now(): the resolver would trust a fabricated quote time
  it('stores a null quote time when the payload carries none', async () => {
    const { service, createCalls } = buildService(null)

    await service.createSwap(swapRequest())

    expect(createCalls[0]?.data).toMatchObject({ quotedAt: null })
  })

  it('drops a malformed quote timestamp rather than failing registration', async () => {
    const { service, createCalls } = buildService(null)

    await service.createSwap(swapRequest({ quotedAt: 'not-a-date' }))

    expect(createCalls[0]?.data).toMatchObject({ quotedAt: null })
  })

  // the route has no runtime validation, and epoch millis would otherwise parse as a valid date
  it('rejects a non-string quote timestamp', async () => {
    const { service, createCalls } = buildService(null)

    await service.createSwap(swapRequest({ quotedAt: 1756729200000 as unknown as string }))

    expect(createCalls[0]?.data).toMatchObject({ quotedAt: null })
  })
})
