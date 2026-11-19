import { UsersService } from '../users/users.service'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

test('an EVM account written with a checksummed address is found by any casing', async () => {
  const stored: string[] = []
  const prisma = {
    user: {
      findFirst: jest.fn(({ where }: { where: { userAccounts: { some: { accountId: string } } } }) =>
        stored.includes(where.userAccounts.some.accountId) ? { id: 'user', userAccounts: [], devices: [] } : null,
      ),
      findUnique: jest.fn(() => ({ id: 'user' })),
      create: jest.fn(({ data }: { data: { userAccounts: { create: { accountId: string }[] } } }) => {
        stored.push(...data.userAccounts.create.map(({ accountId }) => accountId))
        return { id: 'user' }
      }),
    },
  }
  const users = new UsersService(prisma as never, {} as never)
  const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

  await users.createUser({ accountIds: [`eip155:1:${address}`] })

  expect(await users.getUserByAccountId(`eip155:1:${address.toLowerCase()}`)).toMatchObject({ id: 'user' })
  expect(await users.userExistsWithAccountId(`eip155:1:${address}`)).toBe(true)
})
