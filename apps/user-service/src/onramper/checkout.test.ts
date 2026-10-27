import 'reflect-metadata'

import { generateKeyPairSync } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { HttpException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import type { OnramperChallenge, OnramperIntent, OnramperSession } from '@shapeshift/prisma'
import { SecurityRateLimiter } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

import { OnramperCatalogue, OnramperController } from './onramper.controller'
import { OnramperAuthController, OnramperSessions, WalletProofVerifier } from './wallet-auth'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

const intents = new Map<string, OnramperIntent>()
const challenges = new Map<string, OnramperChallenge>()
const sessions = new Map<string, OnramperSession>()
const memoryDb = {
  securityRateLimit: { deleteMany: () => ({ count: 0 }) },
  onramperChallenge: {
    create: ({ data }: { data: OnramperChallenge }) => {
      challenges.set(data.id, data)
      return data
    },
    findUnique: ({ where }: { where: { id: string } }) => challenges.get(where.id),
    deleteMany: ({ where }: { where?: { id?: string; expiresAt?: { gt?: Date; lt?: Date } } } = {}) => {
      const eligible = [...challenges.values()].filter(
        (value) =>
          (!where?.id || value.id === where.id) &&
          (!where?.expiresAt?.gt || value.expiresAt > where.expiresAt.gt) &&
          (!where?.expiresAt?.lt || value.expiresAt < where.expiresAt.lt),
      )
      eligible.forEach((value) => challenges.delete(value.id))
      return { count: eligible.length }
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<OnramperChallenge> }) =>
      Object.assign(challenges.get(where.id), data),
  },
  onramperSession: {
    create: ({ data }: { data: OnramperSession }) => {
      sessions.set(data.id, data)
      return data
    },
    findUnique: ({ where }: { where: { tokenHash?: string; id?: string } }) =>
      [...sessions.values()].find((s) => (where.id ? s.id === where.id : s.tokenHash === where.tokenHash)),
    deleteMany: ({ where }: { where?: { id?: string; expiresAt?: { lt: Date } } } = {}) => {
      const eligible = [...sessions.values()].filter(
        (s) => (!where?.id || s.id === where.id) && (!where?.expiresAt || s.expiresAt < where.expiresAt.lt),
      )
      eligible.forEach((s) => {
        sessions.delete(s.id)
        ;[...intents.values()].filter((i) => i.sessionId === s.id).forEach((i) => intents.delete(i.id))
      })
      return { count: eligible.length }
    },
    updateMany: ({ data }: { data: Partial<OnramperSession> }) => {
      sessions.forEach((s) => Object.assign(s, data))
      return { count: sessions.size }
    },
  },
  onramperIntent: {
    create: ({ data }: { data: OnramperIntent }) => {
      intents.set(data.id, data)
      return data
    },
    findUnique: ({ where }: { where: { id: string } }) => intents.get(where.id),
    deleteMany: ({
      where,
    }: {
      where?: {
        id?: string
        sessionId?: string
        expiresAt?: { gt?: Date; lt?: Date }
        session?: { expiresAt: { gt: Date } }
      }
    } = {}) => {
      const eligible = [...intents.values()].filter(
        (i) =>
          (!where?.id || i.id === where.id) &&
          (!where?.sessionId || i.sessionId === where.sessionId) &&
          (!where?.expiresAt?.gt || i.expiresAt > where.expiresAt.gt) &&
          (!where?.expiresAt?.lt || i.expiresAt < where.expiresAt.lt) &&
          (!where?.session || sessions.get(i.sessionId)?.expiresAt > where.session.expiresAt.gt),
      )
      eligible.forEach((i) => intents.delete(i.id))
      return { count: eligible.length }
    },
    update: ({ where, data }: { where: { id: string }; data: Partial<OnramperIntent> }) =>
      Object.assign(intents.get(where.id), data),
  },
  $transaction: async <T>(fn: (tx: PrismaService) => Promise<T>): Promise<T> =>
    fn(memoryDb as unknown as PrismaService),
}

const databaseUrl = process.env.ONRAMPER_TEST_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/onramper_authorization_test')
    throw new Error('Use a disposable local database named onramper_authorization_test')
  process.env.DATABASE_URL = databaseUrl
}
const db = databaseUrl ? new PrismaService() : (memoryDb as unknown as PrismaService)
const consume = jest.fn()
const catalogue = {
  get: jest.fn(() =>
    Promise.resolve({ message: { crypto: [{ id: 'eth', network: 'ethereum' }], fiat: [{ code: 'USD' }] } }),
  ),
}
let app: INestApplication
let replica: INestApplication
let base: string
let replicaBase: string
const origin = 'https://app.shapeshift.com'
const alice = privateKeyToAccount(generatePrivateKey())
const bob = privateKeyToAccount(generatePrivateKey())
const checkout = {
  crypto: 'eth',
  chainId: 1,
  fiat: 'USD',
  action: 'buy',
  amount: '100',
  language: 'en',
  theme: 'light',
}
const post = (path: string, body: unknown, token?: string, requestOrigin = origin, target = base) =>
  fetch(target + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
async function createApp() {
  const module = await Test.createTestingModule({
    controllers: [OnramperController, OnramperAuthController],
    providers: [
      OnramperSessions,
      WalletProofVerifier,
      { provide: SecurityRateLimiter, useValue: { consume } },
      { provide: OnramperCatalogue, useValue: catalogue },
      { provide: PrismaService, useValue: db },
    ],
  }).compile()
  const result = module.createNestApplication()
  await result.listen(0, '127.0.0.1')
  return result
}

beforeAll(async () => {
  process.env.ONRAMPER_CHECKOUT_ENABLED = 'true'
  process.env.ONRAMPER_ALLOWED_ORIGINS = origin
  process.env.ONRAMPER_API_KEY = 'test-integration'
  process.env.ONRAMPER_PRIVATE_KEY = 'legacy-test-only'
  process.env.ONRAMPER_V2_PRIVATE_KEY = generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  process.env.ONRAMPER_EVM_RPC_URLS = '{}'
  app = await createApp()
  base = await app.getUrl()
  replica = await createApp()
  replicaBase = await replica.getUrl()
})
afterAll(async () => {
  await replica?.close()
  await app?.close()
  if (databaseUrl) await db.$disconnect()
})
beforeEach(async () => {
  await db.onramperIntent.deleteMany({})
  await db.onramperSession.deleteMany({})
  await db.onramperChallenge.deleteMany({})
  consume.mockReset()
  catalogue.get.mockClear()
  process.env.ONRAMPER_CHECKOUT_ENABLED = 'true'
})
async function challenge(account = alice, chainId = 1) {
  const response = await post('/onramper/auth/challenge', { address: account.address, chainId })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string; message: string }>
}
async function authenticate(account = alice, chainId = 1) {
  const issued = await challenge(account, chainId)
  const response = await post('/onramper/auth/verify', {
    id: issued.id,
    signature: await account.signMessage({ message: issued.message }),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ token: string }>
}
async function intent(token: string) {
  const response = await post('/onramper/intents', checkout, token)
  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string; token: string }>
}

test('anonymous callers cannot issue or redeem checkout, even with an allowed Origin', async () => {
  expect((await post('/onramper/intents', checkout)).status).toBe(401)
  expect(
    (await post('/onramper/intents/00000000-0000-4000-8000-000000000000/checkout', { token: '00'.repeat(32) })).status,
  ).toBe(401)
  expect(catalogue.get).not.toHaveBeenCalled()
})
test('legacy key cannot authorize issuance when the V2 key is missing', async () => {
  const session = await authenticate()
  const privateKey = process.env.ONRAMPER_V2_PRIVATE_KEY
  delete process.env.ONRAMPER_V2_PRIVATE_KEY
  try {
    expect((await post('/onramper/intents', checkout, session.token)).status).toBe(503)
    expect(catalogue.get).not.toHaveBeenCalled()
  } finally {
    process.env.ONRAMPER_V2_PRIVATE_KEY = privateKey
  }
})
test('legacy key cannot authorize redemption when the V2 key is missing', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  const privateKey = process.env.ONRAMPER_V2_PRIVATE_KEY
  delete process.env.ONRAMPER_V2_PRIVATE_KEY
  try {
    expect((await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, session.token)).status).toBe(
      503,
    )
  } finally {
    process.env.ONRAMPER_V2_PRIVATE_KEY = privateKey
  }
})
test('wallet proof creates a scoped session and the backend derives the signed destination', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  expect((await db.onramperIntent.findUnique({ where: { id: issued.id } })).tokenHash).not.toBe(issued.token)
  const response = await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, session.token)
  expect(response.status).toBe(201)
  const { url } = (await response.json()) as { url: string }
  const signed = new URL(url)
  expect(signed.searchParams.get('wallets')).toBe(`eth:${alice.address}`)
  expect(signed.searchParams.get('isAddressEditable')).toBe('false')
  expect(signed.searchParams.has('sigV2')).toBe(true)
  expect(url).not.toContain('PRIVATE')
})
test('wrong signatures and edited challenges cannot create sessions', async () => {
  const issued = await challenge()
  expect(
    (
      await post('/onramper/auth/verify', {
        id: issued.id,
        signature: await bob.signMessage({ message: issued.message }),
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await post('/onramper/auth/verify', {
        id: issued.id,
        signature: await alice.signMessage({ message: issued.message.replace(origin.slice(8), 'evil.example') }),
      })
    ).status,
  ).toBe(401)
})
test('challenge verification is single use across concurrent replicas', async () => {
  const issued = await challenge()
  const proof = { id: issued.id, signature: await alice.signMessage({ message: issued.message }) }
  const results = await Promise.all([
    post('/onramper/auth/verify', proof),
    post('/onramper/auth/verify', proof, undefined, origin, replicaBase),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([201, 401])
  expect((await post('/onramper/auth/verify', proof)).status).toBe(401)
})
test('expired challenges and a different Origin are rejected', async () => {
  const issued = await challenge()
  const proof = { id: issued.id, signature: await alice.signMessage({ message: issued.message }) }
  expect((await post('/onramper/auth/verify', proof, undefined, 'https://evil.example')).status).toBe(400)
  await db.onramperChallenge.update({ where: { id: issued.id }, data: { expiresAt: new Date(0) } })
  expect((await post('/onramper/auth/verify', proof)).status).toBe(401)
})
test('unsupported chains and client-controlled signing fields are rejected', async () => {
  expect((await post('/onramper/auth/challenge', { address: alice.address, chainId: 999999 })).status).toBe(400)
  const session = await authenticate()
  expect((await post('/onramper/intents', { ...checkout, address: bob.address }, session.token)).status).toBe(400)
  expect((await post('/onramper/intents', { ...checkout, apiKey: 'attacker' }, session.token)).status).toBe(400)
  expect((await post('/onramper/intents', { ...checkout, chainId: 10 }, session.token)).status).toBe(401)
})
test('wallet network must match the provider currency network', async () => {
  const session = await authenticate(alice, 10)
  expect((await post('/onramper/intents', { ...checkout, chainId: 10 }, session.token)).status).toBe(400)
})
test('a different wallet session, including one for the same address, cannot redeem the intent', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  const otherWallet = await authenticate(bob)
  const otherSession = await authenticate()
  expect(
    (await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, otherWallet.token)).status,
  ).toBe(401)
  expect(
    (await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, otherSession.token)).status,
  ).toBe(401)
})
test('intent redemption is single use across concurrent replicas', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  const path = `/onramper/intents/${issued.id}/checkout`
  const results = await Promise.all([
    post(path, { token: issued.token }, session.token),
    post(path, { token: issued.token }, session.token, origin, replicaBase),
  ])
  expect(results.map((r) => r.status).sort()).toEqual([201, 401])
  expect((await post(path, { token: issued.token }, session.token)).status).toBe(401)
})
test('intent token, checkout fields and application Origin cannot be replaced', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  const path = `/onramper/intents/${issued.id}/checkout`
  expect((await post(path, { token: issued.token, address: bob.address }, session.token)).status).toBe(400)
  expect((await post(path, { token: '00'.repeat(32) }, session.token)).status).toBe(401)
  expect((await post(path, { token: issued.token }, session.token, 'https://evil.example')).status).toBe(401)
})
test('expired sessions and intents cannot be redeemed', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  await db.onramperIntent.update({ where: { id: issued.id }, data: { expiresAt: new Date(0) } })
  expect((await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, session.token)).status).toBe(
    401,
  )
  await db.onramperSession.updateMany({ data: { expiresAt: new Date(0) } })
  expect((await post('/onramper/intents', checkout, session.token)).status).toBe(401)
})
test('logout revokes the session and cascades deletion of outstanding intents', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  const response = await fetch(`${base}/onramper/auth/session`, {
    method: 'DELETE',
    headers: { origin, Authorization: `Bearer ${session.token}` },
  })
  expect(response.status).toBe(200)
  expect(await db.onramperIntent.findUnique({ where: { id: issued.id } })).toBeFalsy()
  expect((await post('/onramper/intents', checkout, session.token)).status).toBe(401)
})
test('lost wallet authorization prevents redemption even with valid session and intent tokens', async () => {
  const session = await authenticate()
  const issued = await intent(session.token)
  const verification = jest.spyOn(app.get(WalletProofVerifier), 'verify').mockResolvedValueOnce(false)
  try {
    expect((await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, session.token)).status).toBe(
      401,
    )
  } finally {
    verification.mockRestore()
  }
})
test('unsupported currencies and unsafe redirects are refused', async () => {
  const session = await authenticate()
  expect((await post('/onramper/intents', { ...checkout, crypto: 'unsupported' }, session.token)).status).toBe(400)
  expect(
    (await post('/onramper/intents', { ...checkout, redirectUrl: 'https://evil.example' }, session.token)).status,
  ).toBe(400)
})
test('pause prevents authenticated checkout', async () => {
  const session = await authenticate()
  process.env.ONRAMPER_CHECKOUT_ENABLED = 'false'
  expect((await post('/onramper/intents', checkout, session.token)).status).toBe(503)
})
test('quota denial happens before provider work', async () => {
  const session = await authenticate()
  consume.mockRejectedValueOnce(new HttpException('Too many requests', 429))
  expect((await post('/onramper/intents', checkout, session.token)).status).toBe(429)
  expect(catalogue.get).not.toHaveBeenCalled()
})
;(databaseUrl ? test : test.skip)(
  'PostgreSQL quotas are shared across replicas and sessions for the same wallet',
  async () => {
    const first = new SecurityRateLimiter(db)
    const second = new SecurityRateLimiter(db)
    const scope = `onramper-quota-test-${Date.now()}`
    const subject = `eip155:1:${alice.address}`
    await first.consume(scope, subject, 2)
    await second.consume(scope, subject, 2)
    await expect(first.consume(scope, subject, 2)).rejects.toMatchObject({ status: 429 })
  },
)
