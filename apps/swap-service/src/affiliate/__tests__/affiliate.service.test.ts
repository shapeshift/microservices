import type { HttpException } from '@nestjs/common'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import type { Affiliate, AffiliateMember } from '@shapeshift/prisma'

import type { PrismaService } from '../../prisma/prisma.service'
import { AffiliateService } from '../affiliate.service'
import type { UpdateAffiliateDto } from '../types'

const BASE_USDC = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

jest.mock('../../utils/assets', () => ({
  tryGetAssetPrecisions: () =>
    Promise.resolve(new Map([['eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 6]])),
}))

type MockAffiliateDelegate = {
  findUnique: jest.Mock
  findFirst: jest.Mock
  create: jest.Mock
  update: jest.Mock
}

type MockAffiliateMemberDelegate = {
  findMany: jest.Mock
  create: jest.Mock
  deleteMany: jest.Mock
}

type MockOptions = {
  affiliate?: Partial<MockAffiliateDelegate>
  member?: Partial<MockAffiliateMemberDelegate>
  swapFindMany?: jest.Mock
}

type PrismaMock = {
  affiliate: MockAffiliateDelegate
  affiliateMember: MockAffiliateMemberDelegate
  swap: { findMany: jest.Mock }
  $executeRaw: jest.Mock
  $transaction: jest.Mock
}

const makePrismaMock = (options: MockOptions = {}): PrismaService => {
  const affiliate: MockAffiliateDelegate = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    ...options.affiliate,
  }
  const affiliateMember: MockAffiliateMemberDelegate = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    ...options.member,
  }
  const swap = { findMany: options.swapFindMany ?? jest.fn().mockResolvedValue([]) }
  // Interactive transactions hand the callback the same delegates so assertions see every call
  const prisma: PrismaMock = {
    affiliate,
    affiliateMember,
    swap,
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  }
  return prisma as unknown as PrismaService
}

const ownerWallet = '0x1111111111111111111111111111111111111111'
const memberWallet = '0x2222222222222222222222222222222222222222'

const baseRow = (overrides?: Partial<Affiliate>): Affiliate => ({
  id: 'a1',
  walletAddress: ownerWallet,
  receiveAddress: null,
  partnerCode: 'goodcode',
  bps: 60,
  isActive: true,
  createdAt: new Date('2026-05-28T00:00:00.000Z'),
  updatedAt: new Date('2026-05-28T00:00:00.000Z'),
  ...overrides,
})

const memberRow = (overrides?: Partial<AffiliateMember>): AffiliateMember => ({
  id: 'm1',
  affiliateId: 'a1',
  walletAddress: memberWallet,
  addedBy: ownerWallet,
  createdAt: new Date('2026-10-14T00:00:00.000Z'),
  ...overrides,
})

// toThrow(error) only compares messages, so pin the class as well
const expectRejection = async (promise: Promise<unknown>, expected: HttpException) => {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(expected.constructor)
  expect(error).toHaveProperty('message', expected.message)
}

// Each lock is a $executeRaw issued inside the one $transaction, parameterized as (namespace, key)
const expectLockedOn = (prisma: PrismaService, keys: Array<[number, string]>) => {
  const { $executeRaw, $transaction } = prisma as unknown as PrismaMock
  expect($transaction).toHaveBeenCalledTimes(1)
  const locks = ($executeRaw.mock.calls as Array<[TemplateStringsArray, number, string]>).map(([strings, ns, key]) => {
    expect(strings.join('?')).toContain('pg_advisory_xact_lock')
    return [ns, key]
  })
  expect(locks).toEqual(keys.map(([ns, key]) => [ns, key.toLowerCase()]))
}

describe('AffiliateService.createAffiliate', () => {
  const register = (service: AffiliateService, partnerCode = 'goodcode') =>
    service.createAffiliate({ walletAddress: ownerWallet, partnerCode, bps: 60 })

  it('creates a row under the wallet and partner code locks when both are unused', async () => {
    const create = jest.fn().mockResolvedValue(baseRow())
    const prisma = makePrismaMock({ affiliate: { create } })
    const service = new AffiliateService(prisma)

    const result = await service.createAffiliate({ walletAddress: ownerWallet, partnerCode: 'goodcode', bps: 75 })

    expect(create).toHaveBeenCalledWith({
      data: { walletAddress: ownerWallet, receiveAddress: undefined, partnerCode: 'goodcode', bps: 75 },
    })
    expect(result.walletAddress).toBe(ownerWallet)
    expectLockedOn(prisma, [
      [1, ownerWallet],
      [2, 'goodcode'],
    ])
  })

  it('rejects when wallet is already registered', async () => {
    const service = new AffiliateService(
      makePrismaMock({ affiliate: { findFirst: jest.fn().mockResolvedValue(baseRow()) } }),
    )

    await expectRejection(register(service, 'newcode'), new ConflictException('Affiliate already registered'))
  })

  it('rejects when wallet is already a member of a partner', async () => {
    const other = baseRow({ id: 'a2', walletAddress: '0x9999999999999999999999999999999999999999' })
    const service = new AffiliateService(
      makePrismaMock({ affiliate: { findFirst: jest.fn().mockResolvedValue(other) } }),
    )

    await expectRejection(
      register(service, 'newcode'),
      new ConflictException('Wallet is already a member of a partner'),
    )
  })

  it('rejects reserved partner codes (case-insensitive)', async () => {
    const service = new AffiliateService(makePrismaMock())

    await expectRejection(register(service, 'ADMIN'), new BadRequestException('This partner code is reserved'))
  })

  it('rejects when partner code is already taken', async () => {
    const create = jest.fn()
    const taken = baseRow({ walletAddress: '0x9999999999999999999999999999999999999999' })
    const service = new AffiliateService(
      makePrismaMock({ affiliate: { findUnique: jest.fn().mockResolvedValue(taken), create } }),
    )

    await expectRejection(register(service), new ConflictException('Partner code already taken'))
    expect(create).not.toHaveBeenCalled()
  })
})

describe('AffiliateService.resolveAffiliateByWalletAddress', () => {
  it('resolves the registering wallet as owner in a single query', async () => {
    const findFirst = jest.fn().mockResolvedValue(baseRow())
    const service = new AffiliateService(makePrismaMock({ affiliate: { findFirst } }))

    await expect(service.resolveAffiliateByWalletAddress(ownerWallet)).resolves.toEqual({
      affiliate: baseRow(),
      role: 'owner',
    })
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ walletAddress: ownerWallet }, { members: { some: { walletAddress: ownerWallet } } }] },
    })
  })

  it('treats the owner match as case-insensitive like the citext column', async () => {
    const service = new AffiliateService(
      makePrismaMock({ affiliate: { findFirst: jest.fn().mockResolvedValue(baseRow()) } }),
    )

    await expect(service.resolveAffiliateByWalletAddress(ownerWallet.toUpperCase())).resolves.toMatchObject({
      role: 'owner',
    })
  })

  it('resolves a member wallet as admin of the owning affiliate', async () => {
    const service = new AffiliateService(
      makePrismaMock({ affiliate: { findFirst: jest.fn().mockResolvedValue(baseRow()) } }),
    )

    await expect(service.resolveAffiliateByWalletAddress(memberWallet)).resolves.toEqual({
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
    const findUnique = jest.fn()
    const service = new AffiliateService(makePrismaMock({ affiliate: { update, findUnique } }))

    await service.updateAffiliate(baseRow(), { bps: 70 })

    expect(update).toHaveBeenCalledWith({ where: { id: baseRow().id }, data: { bps: 70 } })
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('checksums a new receive address', async () => {
    const update = jest.fn().mockResolvedValue(baseRow())
    const service = new AffiliateService(makePrismaMock({ affiliate: { update } }))

    await service.updateAffiliate(baseRow(), { receiveAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' })

    expect(update).toHaveBeenCalledWith({
      where: { id: baseRow().id },
      data: { receiveAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
    })
  })

  it('clears the receive address when given null', async () => {
    const update = jest.fn().mockResolvedValue(baseRow())
    const service = new AffiliateService(makePrismaMock({ affiliate: { update } }))

    await service.updateAffiliate(baseRow({ receiveAddress: '0x9999999999999999999999999999999999999999' }), {
      receiveAddress: null,
    })

    expect(update).toHaveBeenCalledWith({ where: { id: baseRow().id }, data: { receiveAddress: null } })
  })

  it('never forwards isActive, which only ShapeShift controls', async () => {
    const update = jest.fn().mockResolvedValue(baseRow())
    const service = new AffiliateService(makePrismaMock({ affiliate: { update } }))

    await service.updateAffiliate(baseRow(), { bps: 70, isActive: false } as UpdateAffiliateDto)

    expect(update).toHaveBeenCalledWith({ where: { id: baseRow().id }, data: { bps: 70 } })
  })
})

describe('AffiliateService members', () => {
  const owner = baseRow()
  const other = baseRow({ id: 'a2', walletAddress: '0x9999999999999999999999999999999999999999', partnerCode: 'other' })

  // addMember resolves the candidate wallet first; `claimed` is what that lookup returns
  const serviceWhereWalletResolvesTo = (claimed: Affiliate | null, member?: Partial<MockAffiliateMemberDelegate>) =>
    new AffiliateService(makePrismaMock({ affiliate: { findFirst: jest.fn().mockResolvedValue(claimed) }, member }))

  it('lists the owner first, then admins', async () => {
    const service = new AffiliateService(
      makePrismaMock({ member: { findMany: jest.fn().mockResolvedValue([memberRow()]) } }),
    )

    const members = await service.getMembers(owner)

    expect(members.map((m) => [m.walletAddress, m.role])).toEqual([
      [ownerWallet, 'owner'],
      [memberWallet, 'admin'],
    ])
  })

  it('adds a wallet that belongs to nobody, checksummed however it was sent, under the wallet lock', async () => {
    const create = jest.fn().mockResolvedValue(memberRow())
    const prisma = makePrismaMock({ member: { create } })
    const service = new AffiliateService(prisma)

    await service.addMember(owner, {
      walletAddress: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      addedBy: '0xd8da6bf26964af9d7eed9e03e53415d37aa96044',
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        affiliateId: owner.id,
        walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        addedBy: '0xd8dA6Bf26964AF9D7eed9e03e53415D37AA96044',
      },
    })
    expectLockedOn(prisma, [[1, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045']])
  })

  it('rejects adding the owner wallet', async () => {
    const service = serviceWhereWalletResolvesTo(owner)

    await expectRejection(
      service.addMember(owner, { walletAddress: ownerWallet, addedBy: ownerWallet }),
      new ConflictException('Wallet is already the owner'),
    )
  })

  it('rejects adding a wallet that owns another affiliate', async () => {
    const service = serviceWhereWalletResolvesTo(other)

    await expectRejection(
      service.addMember(owner, { walletAddress: other.walletAddress, addedBy: ownerWallet }),
      new ConflictException('Wallet is already registered as an affiliate'),
    )
  })

  it('rejects adding a wallet that is already an admin of this affiliate', async () => {
    const create = jest.fn()
    const service = serviceWhereWalletResolvesTo(owner, { create })

    await expectRejection(
      service.addMember(owner, { walletAddress: memberWallet, addedBy: ownerWallet }),
      new ConflictException('Wallet is already a member'),
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects adding a wallet that is already a member elsewhere', async () => {
    const service = serviceWhereWalletResolvesTo(other)

    await expectRejection(
      service.addMember(owner, { walletAddress: memberWallet, addedBy: ownerWallet }),
      new ConflictException('Wallet is already a member of another partner'),
    )
  })

  it('removes a member only when it belongs to the caller affiliate', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const service = new AffiliateService(makePrismaMock({ member: { deleteMany } }))

    await service.removeMember(owner, memberWallet)

    expect(deleteMany).toHaveBeenCalledWith({ where: { walletAddress: memberWallet, affiliateId: owner.id } })
  })

  it('reports not found when nothing matched, including the owner wallet', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 })
    const service = new AffiliateService(makePrismaMock({ member: { deleteMany } }))

    await expectRejection(service.removeMember(owner, ownerWallet), new NotFoundException('Member not found'))
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
    const service = new AffiliateService(makePrismaMock({ swapFindMany: findMany }))

    await service.getAffiliateSwaps('goodcode', { limit: 50 })

    const where = whereOfFirstCall(findMany)
    expect(where).toMatchObject({ partnerCode: 'goodcode' })
    expect(where).not.toHaveProperty('affiliate')
    expect(where).not.toHaveProperty('partnerAddress')
  })

  it('getAffiliateStats filters directly on partnerCode, with no join or address', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new AffiliateService(makePrismaMock({ swapFindMany: findMany }))

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

  it('values the on-chain fee in a third asset from the asset list and preserves stored affiliateBps', async () => {
    const findMany = jest.fn().mockResolvedValue([
      swapRow({
        actualAffiliateFeeAmountCryptoBaseUnit: '60000',
        affiliateFeeAssetId: BASE_USDC,
        affiliateAssetUsd: '1',
      }),
    ])
    const service = new AffiliateService(makePrismaMock({ swapFindMany: findMany }))

    const { swaps } = await service.getAffiliateSwaps(undefined, { limit: 50 })

    // 60000 USDC base units (6 dp) @ $1 => feeUsd 0.06; partner share = 0.06 * partnerBps 50 / verifiedBps 60 = 0.05
    expect(swaps[0].feeUsd).toBe('0.06')
    expect(swaps[0].partnerFeeUsd).toBe('0.05')
    expect(swaps[0].volumeUsd).toBe('10')
    // stored affiliateBps (55) passes through untouched — not overwritten with verifiedBps (60)
    expect(swaps[0].affiliateBps).toBe(55)
  })

  it('reports no fee rather than the bps-implied estimate when nothing was collected on chain', async () => {
    const findMany = jest.fn().mockResolvedValue([swapRow()])
    const service = new AffiliateService(makePrismaMock({ swapFindMany: findMany }))

    const { swaps } = await service.getAffiliateSwaps(undefined, { limit: 50 })

    expect(swaps[0]).toMatchObject({ feeUsd: null, partnerFeeUsd: null, volumeUsd: '10' })
  })

  it('nulls the fee fields when the swap is unpriceable (no verified fee)', async () => {
    const findMany = jest.fn().mockResolvedValue([swapRow({ affiliateVerificationDetails: null })])
    const service = new AffiliateService(makePrismaMock({ swapFindMany: findMany }))

    const { swaps } = await service.getAffiliateSwaps(undefined, { limit: 50 })

    expect(swaps[0]).toMatchObject({ feeUsd: null, partnerFeeUsd: null, volumeUsd: null })
    // stored affiliateBps is untouched even when the fee can't be computed
    expect(swaps[0].affiliateBps).toBe(55)
  })
})
