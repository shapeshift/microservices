import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import type { Affiliate, AffiliateMember } from '@prisma/client'
import { Prisma } from '@prisma/client'

import type { PrismaService } from '../../prisma/prisma.service'
import { AffiliateService } from '../affiliate.service'
import type { UpdateAffiliateDto } from '../types'

type MockAffiliateDelegate = {
  findUnique: jest.Mock
  findFirst: jest.Mock
  create: jest.Mock
  update: jest.Mock
}

type MockAffiliateMemberDelegate = {
  findUnique: jest.Mock
  findMany: jest.Mock
  create: jest.Mock
  delete: jest.Mock
}

const makePrismaMock = (
  overrides?: Partial<MockAffiliateDelegate>,
  swapFindMany?: jest.Mock,
  memberOverrides?: Partial<MockAffiliateMemberDelegate>,
): PrismaService => {
  const affiliate: MockAffiliateDelegate = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    ...overrides,
  }
  const affiliateMember: MockAffiliateMemberDelegate = {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    delete: jest.fn(),
    ...memberOverrides,
  }
  const swap = { findMany: swapFindMany ?? jest.fn().mockResolvedValue([]) }
  // Interactive transactions hand the callback the same delegates so assertions see every call
  const prisma = {
    affiliate,
    affiliateMember,
    swap,
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  return prisma as unknown as PrismaService
}

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })

// The per-wallet advisory lock must be taken inside the transaction, before any read or write
const expectLockedOn = (prisma: PrismaService, walletAddress: string) => {
  const queryRaw = prisma.$queryRaw as unknown as jest.Mock
  const transaction = prisma.$transaction as unknown as jest.Mock
  expect(transaction).toHaveBeenCalledTimes(1)
  expect(queryRaw).toHaveBeenCalledTimes(1)
  const [strings, key] = queryRaw.mock.calls[0] as [TemplateStringsArray, string]
  expect(strings.join('?')).toContain('pg_advisory_xact_lock')
  expect(key).toBe(walletAddress.toLowerCase())
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
    expectLockedOn(prisma, wallet)
  })

  it('rejects when wallet is already registered', async () => {
    const prisma = makePrismaMock({
      findUnique: jest.fn().mockResolvedValueOnce(baseRow()),
    })
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'newcode', bps: 60 })).rejects.toThrow(
      ConflictException,
    )
  })

  it('rejects when wallet is already a member of a partner', async () => {
    const prisma = makePrismaMock(undefined, undefined, {
      findUnique: jest.fn().mockResolvedValue(memberRow()),
    })
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'newcode', bps: 60 })).rejects.toThrow(
      /already a member/,
    )
  })

  it('rejects reserved partner codes (case-insensitive)', async () => {
    const prisma = makePrismaMock()
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'ADMIN', bps: 60 })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('maps a partner code unique violation raised by the insert to a conflict', async () => {
    const create = jest.fn().mockRejectedValue(uniqueViolation())
    const prisma = makePrismaMock({ create })
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'goodcode', bps: 60 })).rejects.toThrow(
      ConflictException,
    )
  })

  it('does not swallow non-unique insert failures', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connection reset'))
    const prisma = makePrismaMock({ create })
    const service = new AffiliateService(prisma)

    await expect(service.createAffiliate({ walletAddress: wallet, partnerCode: 'goodcode', bps: 60 })).rejects.toThrow(
      'connection reset',
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

const memberRow = (overrides?: Partial<AffiliateMember>): AffiliateMember => ({
  id: 'm1',
  affiliateId: 'a1',
  walletAddress: '0x2222222222222222222222222222222222222222',
  addedBy: '0x1111111111111111111111111111111111111111',
  createdAt: new Date('2026-10-14T00:00:00.000Z'),
  ...overrides,
})

describe('AffiliateService.resolveAffiliateByWalletAddress', () => {
  it('resolves the registering wallet as owner in a single query', async () => {
    const findFirst = jest.fn().mockResolvedValue(baseRow())
    const prisma = makePrismaMock({ findFirst })
    const service = new AffiliateService(prisma)

    await expect(service.resolveAffiliateByWalletAddress(baseRow().walletAddress)).resolves.toEqual({
      affiliate: baseRow(),
      role: 'owner',
    })
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ walletAddress: baseRow().walletAddress }, { members: { some: { walletAddress: baseRow().walletAddress } } }],
      },
    })
    expect(prisma.affiliateMember.findUnique).not.toHaveBeenCalled()
  })

  it('treats the owner match as case-insensitive like the citext column', async () => {
    const prisma = makePrismaMock({ findFirst: jest.fn().mockResolvedValue(baseRow()) })
    const service = new AffiliateService(prisma)

    await expect(service.resolveAffiliateByWalletAddress(baseRow().walletAddress.toUpperCase())).resolves.toMatchObject(
      { role: 'owner' },
    )
  })

  it('resolves a member wallet as admin of the owning affiliate', async () => {
    const prisma = makePrismaMock({ findFirst: jest.fn().mockResolvedValue(baseRow()) })
    const service = new AffiliateService(prisma)

    await expect(service.resolveAffiliateByWalletAddress(memberRow().walletAddress)).resolves.toEqual({
      affiliate: baseRow(),
      role: 'admin',
    })
  })

  it('resolves nothing for an unknown wallet', async () => {
    const service = new AffiliateService(makePrismaMock())

    await expect(
      service.resolveAffiliateByWalletAddress('0x3333333333333333333333333333333333333333'),
    ).resolves.toBeNull()
  })
})

describe('AffiliateService.updateAffiliate', () => {
  it('writes only the provided fields against the resolved affiliate without refetching it', async () => {
    const update = jest.fn().mockResolvedValue(baseRow({ bps: 70 }))
    const prisma = makePrismaMock({ update })
    const service = new AffiliateService(prisma)

    await service.updateAffiliate(baseRow(), { bps: 70 })

    expect(update).toHaveBeenCalledWith({ where: { id: baseRow().id }, data: { bps: 70 } })
    expect(prisma.affiliate.findUnique).not.toHaveBeenCalled()
  })

  it('checksums a new receive address', async () => {
    const update = jest.fn().mockResolvedValue(baseRow())
    const service = new AffiliateService(makePrismaMock({ update }))

    await service.updateAffiliate(baseRow(), { receiveAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' })

    expect(update).toHaveBeenCalledWith({
      where: { id: baseRow().id },
      data: { receiveAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    })
  })

  it('never forwards isActive, which only ShapeShift controls', async () => {
    const update = jest.fn().mockResolvedValue(baseRow())
    const service = new AffiliateService(makePrismaMock({ update }))

    await service.updateAffiliate(baseRow(), { bps: 70, isActive: false } as UpdateAffiliateDto)

    expect(update).toHaveBeenCalledWith({ where: { id: baseRow().id }, data: { bps: 70 } })
  })
})

describe('AffiliateService members', () => {
  const owner = baseRow()
  const other = baseRow({ id: 'a2', walletAddress: '0x9999999999999999999999999999999999999999', partnerCode: 'other' })
  const newWallet = '0x2222222222222222222222222222222222222222'

  it('lists the owner first, then admins', async () => {
    const prisma = makePrismaMock(undefined, undefined, { findMany: jest.fn().mockResolvedValue([memberRow()]) })
    const service = new AffiliateService(prisma)

    const members = await service.getMembers(owner)

    expect(members.map((m) => [m.walletAddress, m.role])).toEqual([
      [owner.walletAddress, 'owner'],
      [memberRow().walletAddress, 'admin'],
    ])
  })

  it('adds a wallet that belongs to nobody, checksummed however it was sent', async () => {
    const create = jest.fn().mockResolvedValue(memberRow())
    const prisma = makePrismaMock(undefined, undefined, { create })
    const service = new AffiliateService(prisma)

    await service.addMember(
      owner,
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96044',
    )

    expect(create).toHaveBeenCalledWith({
      data: {
        affiliateId: owner.id,
        walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        addedBy: '0xd8dA6Bf26964AF9D7eed9e03e53415D37AA96044',
      },
    })
    expectLockedOn(prisma, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  })

  it('rejects adding a wallet that is already an admin of this affiliate', async () => {
    const create = jest.fn()
    const prisma = makePrismaMock(undefined, undefined, {
      findUnique: jest.fn().mockResolvedValue(memberRow({ affiliateId: owner.id })),
      create,
    })
    const service = new AffiliateService(prisma)

    await expect(service.addMember(owner, newWallet, owner.walletAddress)).rejects.toThrow(ConflictException)
    await expect(service.addMember(owner, newWallet, owner.walletAddress)).rejects.toThrow(/already a member$/)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects adding the owner wallet', async () => {
    const prisma = makePrismaMock({ findUnique: jest.fn().mockResolvedValue(owner) })
    const service = new AffiliateService(prisma)

    await expect(service.addMember(owner, owner.walletAddress, owner.walletAddress)).rejects.toThrow(
      /already the owner/,
    )
  })

  it('rejects adding a wallet that owns another affiliate', async () => {
    const prisma = makePrismaMock({ findUnique: jest.fn().mockResolvedValue(other) })
    const service = new AffiliateService(prisma)

    await expect(service.addMember(owner, other.walletAddress, owner.walletAddress)).rejects.toThrow(
      /already registered as an affiliate/,
    )
  })

  it('rejects adding a wallet that is already a member elsewhere', async () => {
    const prisma = makePrismaMock(undefined, undefined, {
      findUnique: jest.fn().mockResolvedValue(memberRow({ affiliateId: other.id })),
    })
    const service = new AffiliateService(prisma)

    await expect(service.addMember(owner, newWallet, owner.walletAddress)).rejects.toThrow(/another partner/)
  })

  it('only removes members of the caller affiliate', async () => {
    const del = jest.fn()
    const prisma = makePrismaMock(undefined, undefined, {
      findUnique: jest.fn().mockResolvedValue(memberRow({ affiliateId: other.id })),
      delete: del,
    })
    const service = new AffiliateService(prisma)

    await expect(service.removeMember(owner, newWallet)).rejects.toThrow(NotFoundException)
    expect(del).not.toHaveBeenCalled()
  })

  it('cannot remove the owner, who is never a member row', async () => {
    const del = jest.fn()
    const prisma = makePrismaMock(undefined, undefined, { delete: del })
    const service = new AffiliateService(prisma)

    await expect(service.removeMember(owner, owner.walletAddress)).rejects.toThrow(NotFoundException)
    expect(del).not.toHaveBeenCalled()
  })

  it('removes a member of the caller affiliate', async () => {
    const del = jest.fn()
    const prisma = makePrismaMock(undefined, undefined, {
      findUnique: jest.fn().mockResolvedValue(memberRow()),
      delete: del,
    })
    const service = new AffiliateService(prisma)

    await service.removeMember(owner, newWallet)

    expect(del).toHaveBeenCalledWith({ where: { id: memberRow().id } })
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
