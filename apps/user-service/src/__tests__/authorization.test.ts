import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { ReferralService } from '../referral/referral.service'
import { UsersService } from '../users/users.service'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

let app: INestApplication
let baseUrl: string
beforeAll(async () => {
  process.env.SERVICE_API_KEY = 'test-only-internal-service-key'
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ count: 1 }]) })
    .overrideProvider(UsersService)
    .useValue({ getAllUsers: () => [] })
    .overrideProvider(ReferralService)
    .useValue({})
    .compile()
  app = module.createNestApplication()
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()
})
afterAll(async () => {
  await app?.close()
})

test.each([
  ['GET', '/users'],
  ['POST', '/users/get-or-create'],
  ['POST', '/users/victim/devices'],
  ['GET', '/referrals/codes/test'],
])('anonymous %s %s is rejected by the real HTTP guard', async (method, path) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
  expect(response.status).toBe(401)
})

test('a wrong service credential is rejected', async () => {
  const response = await fetch(baseUrl + '/users', { headers: { 'x-api-key': 'incorrect' } })
  expect(response.status).toBe(401)
})

test('an authenticated service can enumerate users', async () => {
  const response = await fetch(baseUrl + '/users', { headers: { 'x-api-key': 'test-only-internal-service-key' } })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([])
})

// Onramper keeps its wallet-session authorization when device auth is registered globally.
test('Onramper challenge reaches its own validation without a service credential', async () => {
  const response = await fetch(baseUrl + '/onramper/auth/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  expect(response.status).toBe(400)
})

test('Onramper checkout still enforces its wallet-session guard', async () => {
  process.env.ONRAMPER_CHECKOUT_ENABLED = 'true'
  const response = await fetch(baseUrl + '/onramper/intents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ message: 'Wallet authentication required' })
  delete process.env.ONRAMPER_CHECKOUT_ENABLED
})
