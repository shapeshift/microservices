import { SwapsService } from '../swaps.service'

// swaps.service.ts transitively imports the unchained-client ESM bundle, which this
// project's ts-jest transform does not process. resolvePartner only touches Prisma, so
// none of that surface is exercised here — stub it to keep the module loadable.
// (ts-jest hoists this above the import at compile time.)
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// The service constructor eagerly builds its HTTP clients, which demand these at runtime.
process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

type PartnerResolution = { partnerCode: string | null; partnerAddress: string | null }

// resolvePartner is private; these tests drive it directly because it is the single
// gate that turns a client-supplied partner code or address into an attribution.
type ResolvePartner = (data: unknown) => Promise<PartnerResolution>

type AffiliateRow = {
  partnerCode: string
  receiveAddress: string | null
  walletAddress: string
  isActive: boolean
}

type FindUniqueArgs = { where?: { partnerCode?: string } }
type FindManyArgs = { where?: { isActive?: boolean } }

const buildService = (affiliate: AffiliateRow | null, matches: { partnerCode: string }[] = []) => {
  const findUniqueCalls: FindUniqueArgs[] = []
  const findManyCalls: FindManyArgs[] = []

  const prisma = {
    affiliate: {
      findUnique: (args: FindUniqueArgs): Promise<AffiliateRow | null> => {
        findUniqueCalls.push(args)
        return Promise.resolve(affiliate)
      },
      findMany: (args: FindManyArgs): Promise<{ partnerCode: string }[]> => {
        findManyCalls.push(args)
        return Promise.resolve(matches)
      },
    },
  }

  const stub = {} as never
  const service = new SwapsService(prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub)
  const svc = service as unknown as { resolvePartner: ResolvePartner }

  return {
    resolvePartner: (data: unknown): Promise<PartnerResolution> => svc.resolvePartner(data),
    findUniqueCalls,
    findManyCalls,
  }
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

describe('resolvePartner', () => {
  it('attributes a swap to an active partner code', async () => {
    const { resolvePartner, findUniqueCalls } = buildService(activeAffiliate)

    await expect(resolvePartner({ partnerCode: 'acme' })).resolves.toEqual({
      partnerCode: 'acme',
      partnerAddress: '0xreceive',
    })

    // the lookup has to key off the supplied code, or attribution is resolving the wrong partner
    expect(findUniqueCalls[0]?.where?.partnerCode).toBe('acme')
  })

  it('refuses to attribute a swap to a deactivated partner code', async () => {
    const { resolvePartner } = buildService(deactivatedAffiliate)

    await expect(resolvePartner({ partnerCode: 'inactive-partner' })).resolves.toEqual({
      partnerCode: null,
      partnerAddress: null,
    })
  })

  it('falls through to address resolution when the code is deactivated', async () => {
    const { resolvePartner, findManyCalls } = buildService(deactivatedAffiliate, [])

    await expect(resolvePartner({ partnerCode: 'inactive-partner', partnerAddress: '0xwallet' })).resolves.toEqual({
      partnerCode: null,
      partnerAddress: '0xwallet',
    })

    // an active code short-circuits before this, so reaching findMany proves the guard rejected it
    expect(findManyCalls).toHaveLength(1)
  })

  // NOTE: the address path filters in Postgres, so this can only assert that the filter was
  // *requested*. Proving it is applied needs an integration test against a real database.
  it('only matches active affiliates when resolving by partner address', async () => {
    const { resolvePartner, findManyCalls } = buildService(null, [{ partnerCode: 'acme' }])

    await expect(resolvePartner({ partnerAddress: '0xwallet' })).resolves.toEqual({
      partnerCode: 'acme',
      partnerAddress: '0xwallet',
    })

    expect(findManyCalls[0]?.where?.isActive).toBe(true)
  })

  it('leaves the swap unattributed when no partner is supplied', async () => {
    const { resolvePartner, findUniqueCalls, findManyCalls } = buildService(null)

    await expect(resolvePartner({})).resolves.toEqual({ partnerCode: null, partnerAddress: null })

    expect(findUniqueCalls).toHaveLength(0)
    expect(findManyCalls).toHaveLength(0)
  })
})
