import type { CreateSwapDto } from '@shapeshift/shared-types'

import { SwapsService } from '../swaps.service'

// swaps.service.ts transitively imports the unchained-client ESM bundle, which this
// project's ts-jest transform does not process. Partner resolution only touches Prisma,
// so none of that surface is exercised here — stub it to keep the module loadable.
// (ts-jest hoists this above the imports at compile time.)
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// The service constructor eagerly builds its HTTP clients, which demand these at runtime.
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

// userId is deliberately omitted: getReferralCode short-circuits on it, which keeps the
// user-service client out of the test without having to stub it.
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
      // echo the row back so toSwap has something to spread; the assertions read createCalls
      create: (args: CreateArgs): Promise<Record<string, unknown>> => {
        createCalls.push(args)
        return Promise.resolve({ ...args.data, createdAt: new Date(0), updatedAt: new Date(0) })
      },
    },
  }

  const stub = {} as never
  const service = new SwapsService(prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub)

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

    // partnerAddress comes from the registry, never from the caller
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

  // The address path filters in Postgres, so a mocked client can only assert that the filter
  // was *requested*. Proving it is applied needs an integration test against a real database.
  it('requests only active affiliates when resolving by partner address', async () => {
    const { service, findManyCalls } = buildService(null, [{ partnerCode: 'acme' }])

    await service.createSwap(swapRequest({ partnerAddress: '0xwallet' }))

    expect(findManyCalls[0]?.where?.isActive).toBe(true)
  })
})
