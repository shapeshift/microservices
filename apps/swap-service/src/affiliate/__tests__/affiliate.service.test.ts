import type { Affiliate } from '@prisma/client'

import type { PrismaService } from '../../prisma/prisma.service'
import { AffiliateService } from '../affiliate.service'

type MockAffiliateDelegate = {
  findUnique: jest.Mock
  create: jest.Mock
}

const makePrismaMock = (overrides?: Partial<MockAffiliateDelegate>): PrismaService => {
  const affiliate: MockAffiliateDelegate = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    ...overrides,
  }
  return { affiliate } as unknown as PrismaService
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
