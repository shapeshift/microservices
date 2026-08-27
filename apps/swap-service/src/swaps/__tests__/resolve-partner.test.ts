// swaps.service.ts transitively imports the unchained-client ESM bundle, which this
// project's ts-jest transform does not process. resolvePartner only touches Prisma, so
// none of that surface is exercised here — stub it to keep the module loadable.
import { SwapsService } from '../swaps.service'

jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// The service constructor eagerly builds its HTTP clients, which demand these at runtime.
process.env.NOTIFICATIONS_SERVICE_URL ??= 'http://notifications.test'
process.env.USER_SERVICE_URL ??= 'http://user.test'
process.env.SERVICE_API_KEY ??= 'test-api-key'

// resolvePartner is private; these tests drive it directly because it is the single
// gate that turns a client-supplied partner code or address into an attribution.
type ResolvePartner = (data: unknown) => Promise<{ partnerCode: string | null; partnerAddress: string | null }>

const buildService = (affiliate: Record<string, unknown> | null, matches: Record<string, unknown>[] = []) => {
  const findUnique = jest.fn().mockResolvedValue(affiliate)
  const findMany = jest.fn().mockResolvedValue(matches)

  const prisma = { affiliate: { findUnique, findMany } }
  const stub = {} as never

  const service = new SwapsService(prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub)

  const resolvePartner = (service as unknown as { resolvePartner: ResolvePartner }).resolvePartner.bind(service)

  return { resolvePartner, findUnique, findMany }
}

describe('resolvePartner', () => {
  it('attributes a swap to an active partner code', async () => {
    const { resolvePartner } = buildService({
      partnerCode: 'acme',
      receiveAddress: '0xreceive',
      walletAddress: '0xwallet',
      isActive: true,
    })

    await expect(resolvePartner({ partnerCode: 'acme' })).resolves.toEqual({
      partnerCode: 'acme',
      partnerAddress: '0xreceive',
    })
  })

  it('refuses to attribute a swap to a deactivated partner code', async () => {
    const { resolvePartner } = buildService({
      partnerCode: 'inactive-partner',
      receiveAddress: '0xreceive',
      walletAddress: '0xwallet',
      isActive: false,
    })

    await expect(resolvePartner({ partnerCode: 'inactive-partner' })).resolves.toEqual({
      partnerCode: null,
      partnerAddress: null,
    })
  })

  it('does not let a deactivated partner slip back in via its own address', async () => {
    const { resolvePartner } = buildService(
      { partnerCode: 'inactive-partner', receiveAddress: '0xreceive', walletAddress: '0xwallet', isActive: false },
      [],
    )

    await expect(resolvePartner({ partnerCode: 'inactive-partner', partnerAddress: '0xwallet' })).resolves.toEqual({
      partnerCode: null,
      partnerAddress: '0xwallet',
    })
  })

  it('only matches active affiliates when resolving by partner address', async () => {
    const { resolvePartner, findMany } = buildService(null, [{ partnerCode: 'acme' }])

    await expect(resolvePartner({ partnerAddress: '0xwallet' })).resolves.toEqual({
      partnerCode: 'acme',
      partnerAddress: '0xwallet',
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    )
  })

  it('leaves the swap unattributed when no partner is supplied', async () => {
    const { resolvePartner } = buildService(null)

    await expect(resolvePartner({})).resolves.toEqual({ partnerCode: null, partnerAddress: null })
  })
})
