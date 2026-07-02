import type { Affiliate } from '@prisma/client'

import type { PrismaService } from '../../prisma/prisma.service'
import { AffiliateService } from '../affiliate.service'

type MockAffiliateDelegate = {
  findUnique: jest.Mock
  create: jest.Mock
}

const makePrismaMock = (overrides?: Partial<MockAffiliateDelegate>, swapFindMany?: jest.Mock): PrismaService => {
  const affiliate: MockAffiliateDelegate = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    ...overrides,
  }
  const swap = { findMany: swapFindMany ?? jest.fn().mockResolvedValue([]) }
  return { affiliate, swap } as unknown as PrismaService
}

const baseRow = (overrides?: Partial<Affiliate>): Affiliate => ({
  id: 'a1',
  walletAddress: '0x1111111111111111111111111111111111111111',
  receiveAddress: null,
  partnerCode: 'goodcode',
  bps: 60,
  isActive: true,
  createdAt: new Date('2026-05-28T00:00:00.000Z'),
  updatedAt: new Date('2026-05-28T00:00:00.000Z'),
  ...overrides,
})

describe('AffiliateService.createAffiliate', () => {
  const wallet = '0x1111111111111111111111111111111111111111'

  it('creates a row when wallet and code are unused', async () => {
    const create = jest.fn().mockResolvedValue(baseRow())
    const prisma = makePrismaMock({ create })
    const service = new AffiliateService(prisma)

    const result = await service.createAffiliate({
      walletAddress: wallet,
      partnerCode: 'goodcode',
      bps: 75,
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        walletAddress: wallet,
        receiveAddress: undefined,
        partnerCode: 'goodcode',
        bps: 75,
      },
    })
    expect(result.walletAddress).toBe(wallet)
  })

  it('rejects when wallet is already registered', async () => {
    const prisma = makePrismaMock({
      findUnique: jest.fn().mockResolvedValueOnce(baseRow()),
    })
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'newcode', bps: 60 })).rejects.toThrow(
      /already/,
    )
  })

  it('rejects reserved partner codes (case-insensitive)', async () => {
    const prisma = makePrismaMock()
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'ADMIN', bps: 60 })).rejects.toThrow(
      /reserved/,
    )
  })

  it('rejects when partner code is already taken', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null) // wallet lookup
      .mockResolvedValueOnce(baseRow({ walletAddress: '0xother', partnerCode: 'goodcode' }))
    const prisma = makePrismaMock({ findUnique })
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'goodcode', bps: 60 })).rejects.toThrow(
      /taken/,
    )
  })
})

describe('AffiliateService attribution reads', () => {
  // Pull the `where` from the first prisma.swap.findMany call as a typed object so the
  // assertions below don't trip the no-unsafe-any lint rules on jest's `any`-typed calls.
  const whereOfFirstCall = (findMany: jest.Mock): Record<string, unknown> => {
    const [[args]] = findMany.mock.calls as Array<[{ where: Record<string, unknown> }]>
    return args.where
  }

  it('getAffiliateSwaps filters directly on partnerCode, with no join or address', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new AffiliateService(makePrismaMock(undefined, findMany))

    await service.getAffiliateSwaps('goodcode', { limit: 50 })

    const where = whereOfFirstCall(findMany)
    expect(where).toMatchObject({ partnerCode: 'goodcode' })
    expect(where).not.toHaveProperty('affiliate')
    expect(where).not.toHaveProperty('partnerAddress')
  })

  it('getAffiliateStats filters directly on partnerCode, with no join or address', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new AffiliateService(makePrismaMock(undefined, findMany))

    const result = await service.getAffiliateStats('goodcode', {})

    const where = whereOfFirstCall(findMany)
    expect(where).toMatchObject({ partnerCode: 'goodcode', status: 'SUCCESS', isAffiliateVerified: true })
    expect(where).not.toHaveProperty('affiliate')
    expect(where).not.toHaveProperty('partnerAddress')
    expect(result).toEqual({ totalSwaps: 0, totalVolumeUsd: '0.00', totalFeesEarnedUsd: '0.00' })
  })
})

describe('AffiliateService.getAffiliateSwaps fee-split enrichment', () => {
  const swapRow = (over: Record<string, unknown> = {}) => ({
    swapId: 's1',
    partnerCode: 'alpha',
    swapperName: 'THORChain',
    sellTxHash: '0xAAA',
    buyTxHash: null,
    partnerBps: 50,
    shapeshiftBps: 10,
    affiliateBps: 55,
    status: 'SUCCESS',
    isAffiliateVerified: true,
    sellAsset: { precision: 8 },
    buyAsset: {},
    metadata: {},
    sellAmountCryptoBaseUnit: '100000000',
    sellAssetUsd: '10',
    actualAffiliateFeeAmountCryptoBaseUnit: null,
    affiliateFeeAssetId: null,
    affiliateAssetUsd: null,
    affiliateVerificationDetails: {
      hasAffiliate: true,
      affiliateBps: 60,
      verifiedSellAmountCryptoBaseUnit: '100000000',
    },
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    updatedAt: new Date('2026-06-01T12:00:00.000Z'),
    ...over,
  })

  it('derives feeUsd/partnerFeeUsd/volumeUsd from the verified fee and preserves stored affiliateBps', async () => {
    const findMany = jest.fn().mockResolvedValue([swapRow()])
    const service = new AffiliateService(makePrismaMock(undefined, findMany))

    const { swaps } = await service.getAffiliateSwaps(undefined, { limit: 50 })

    // verifiedBps 60, sell 1.0 unit @ $10 => feeUsd = 10 * 60/10000 = 0.06 (full-precision string, no rounding)
    // partner share = feeUsd * partnerBps/verifiedBps = 0.06 * 50/60 = 0.05
    expect(swaps[0].feeUsd).toBe('0.06')
    expect(swaps[0].partnerFeeUsd).toBe('0.05')
    expect(swaps[0].volumeUsd).toBe('10')
    // stored affiliateBps (55) passes through untouched — not overwritten with verifiedBps (60)
    expect(swaps[0].affiliateBps).toBe(55)
  })

  it('nulls the fee fields when the swap is unpriceable (no verified fee)', async () => {
    const findMany = jest.fn().mockResolvedValue([swapRow({ affiliateVerificationDetails: null })])
    const service = new AffiliateService(makePrismaMock(undefined, findMany))

    const { swaps } = await service.getAffiliateSwaps(undefined, { limit: 50 })

    expect(swaps[0]).toMatchObject({ feeUsd: null, partnerFeeUsd: null, volumeUsd: null })
    // stored affiliateBps is untouched even when the fee can't be computed
    expect(swaps[0].affiliateBps).toBe(55)
  })
})
