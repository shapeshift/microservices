import type { PrismaService } from '../../prisma/prisma.service'
import { AffiliateService } from '../affiliate.service'

const swapRow = (over: Record<string, unknown> = {}) => ({
  swapId: 's1',
  partnerCode: 'alpha',
  swapperName: 'THORChain',
  sellTxHash: '0xAAA',
  buyTxHash: null,
  partnerBps: 50,
  shapeshiftBps: 10,
  affiliateBps: 0,
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
  affiliateVerificationDetails: { hasAffiliate: true, affiliateBps: 60, verifiedSellAmountCryptoBaseUnit: '100000000' },
  createdAt: new Date('2026-06-01T12:00:00.000Z'),
  updatedAt: new Date('2026-06-01T12:00:00.000Z'),
  ...over,
})

type FindManyArgs = { where: Record<string, unknown> }
type FindManyMock = jest.Mock<Promise<unknown[]>, [FindManyArgs]>

const prismaWith = (findMany: FindManyMock): PrismaService =>
  ({ affiliate: { findUnique: jest.fn() }, swap: { findMany } }) as unknown as PrismaService

describe('AffiliateService.getAffiliateSwaps', () => {
  it('omitting partnerCode queries all partner swaps (partnerCode not null)', async () => {
    const findMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>().mockResolvedValue([])
    const service = new AffiliateService(prismaWith(findMany))

    await service.getAffiliateSwaps(undefined, { limit: 50 })

    expect(findMany.mock.calls[0][0].where).toMatchObject({ partnerCode: { not: null } })
  })

  it('providing partnerCode filters to that partner', async () => {
    const findMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>().mockResolvedValue([])
    const service = new AffiliateService(prismaWith(findMany))

    await service.getAffiliateSwaps('alpha', { limit: 50 })

    expect(findMany.mock.calls[0][0].where).toMatchObject({ partnerCode: 'alpha' })
  })

  it('enriches rows with affiliateBps, feeUsd, partnerFeeUsd, volumeUsd', async () => {
    const findMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>().mockResolvedValue([swapRow()])
    const service = new AffiliateService(prismaWith(findMany))

    const { swaps } = await service.getAffiliateSwaps(undefined, { limit: 50 })

    // verifiedBps 60, sell 1.0 unit @ $10 => feeUsd = 10 * 60/10000 = 0.06
    // partner rate = 50/60 => partnerFeeUsd = 0.06 * (50/60) = 0.05
    expect(swaps[0].affiliateBps).toBe(60)
    expect(swaps[0].feeUsd).toBeCloseTo(0.06, 6)
    expect(swaps[0].partnerFeeUsd).toBeCloseTo(0.05, 6)
    expect(swaps[0].volumeUsd).toBeCloseTo(10, 6)
  })
})
