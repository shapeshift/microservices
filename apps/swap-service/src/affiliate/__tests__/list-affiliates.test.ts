import type { PrismaService } from '../../prisma/prisma.service'
import { AffiliateService } from '../affiliate.service'

const prismaWith = (findMany: jest.Mock): PrismaService =>
  ({ affiliate: { findMany }, swap: { findMany: jest.fn() } }) as unknown as PrismaService

describe('AffiliateService.listAffiliates', () => {
  it('maps affiliates to { partnerCode, bps, isActive }', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { partnerCode: 'alpha', bps: 60, isActive: true, walletAddress: '0xabc', receiveAddress: null },
      { partnerCode: 'beta', bps: 30, isActive: false, walletAddress: '0xdef', receiveAddress: null },
    ])
    const service = new AffiliateService(prismaWith(findMany))

    const result = await service.listAffiliates()

    expect(result).toEqual([
      { partnerCode: 'alpha', bps: 60, isActive: true },
      { partnerCode: 'beta', bps: 30, isActive: false },
    ])
  })
})
