import 'reflect-metadata'

import type { KeyObject } from 'node:crypto'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { NotificationsServiceClient } from '@shapeshift/shared-utils'

import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { ReferralService } from '../referral/referral.service'
import { UsersService } from '../users/users.service'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

type Challenge = { id: string; keyId: string; publicKey: string; message: string; origin: string; expiresAt: Date }
type Session = { tokenHash: string; userId: string; expiresAt: Date }
type Pending = { id: string; userId: string; deviceToken: string; nonceHash: string; expiresAt: Date }
const challenges = new Map<string, Challenge>()
const identities = new Map<string, { keyId: string; userId: string }>()
const sessions = new Map<string, Session>()
const registrations = new Map<string, Pending>()
const deviceUpsert = jest.fn(() => ({ id: 'device-1', deviceType: 'MOBILE', isActive: true }))
const registerDevice = jest.fn((data: { userId: string; deviceType: string }) => ({
  id: 'device-1',
  ...data,
  isActive: true,
}))
const db = {
  deviceChallenge: {
    create: ({ data }: { data: Challenge }) => {
      challenges.set(data.id, data)
      return data
    },
    findUnique: ({ where }: { where: { id: string } }) => challenges.get(where.id),
    deleteMany: ({ where }: { where: { id?: string } }) => ({
      count: where.id ? Number(challenges.delete(where.id)) : 0,
    }),
  },
  deviceIdentity: {
    findUnique: ({ where }: { where: { keyId: string } }) => identities.get(where.keyId),
    upsert: ({ where }: { where: { keyId: string } }) => {
      const row = identities.get(where.keyId) ?? { keyId: where.keyId, userId: `profile-${identities.size + 1}` }
      identities.set(where.keyId, row)
      return row
    },
  },
  deviceSession: {
    create: ({ data }: { data: Session }) => {
      sessions.set(data.tokenHash, data)
      return data
    },
    findUnique: ({ where }: { where: { tokenHash: string } }) => sessions.get(where.tokenHash),
    deleteMany: ({ where }: { where: { tokenHash?: string } }) => ({
      count: where.tokenHash ? Number(sessions.delete(where.tokenHash)) : 0,
    }),
  },
  pushRegistration: {
    create: ({ data }: { data: Pending }) => {
      registrations.set(data.id, data)
      return data
    },
    findUnique: ({ where }: { where: { id: string } }) => registrations.get(where.id),
    deleteMany: ({ where }: { where: { id?: string } }) => ({
      count: where.id ? Number(registrations.delete(where.id)) : 0,
    }),
  },
  device: { findUnique: () => ({ userId: 'legacy-user', isActive: true }), upsert: deviceUpsert },
  securityRateLimit: { deleteMany: () => ({ count: 0 }) },
  $queryRaw: () => [{ count: 1 }],
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
}
let app: INestApplication
let base: string
const origin = 'https://app.shapeshift.com'
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const api = (path: string, body?: unknown, token?: string, requestOrigin = origin, method?: string) =>
  fetch(base + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
const signed = (challenge: { id: string; message: string }, privateKey = keys.privateKey) => ({
  id: challenge.id,
  signature: sign('sha256', Buffer.from(challenge.message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64',
  ),
})
const delivered = jest.spyOn(NotificationsServiceClient.prototype, 'sendDeviceVerification').mockResolvedValue()

beforeAll(async () => {
  process.env.SERVICE_API_KEY = 'test-server-key'
  process.env.NOTIFICATIONS_SERVICE_URL = 'http://unused.example'
  process.env.DEVICE_ALLOWED_ORIGINS = origin
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(UsersService)
    .useValue({ getUserById: (id: string) => ({ id }), registerDevice })
    .overrideProvider(ReferralService)
    .useValue({})
    .compile()
  app = module.createNestApplication()
  await app.listen(0, '127.0.0.1')
  base = await app.getUrl()
})
afterAll(async () => app?.close())
beforeEach(() => {
  challenges.clear()
  identities.clear()
  sessions.clear()
  registrations.clear()
  delivered.mockClear()
  deviceUpsert.mockClear()
  registerDevice.mockClear()
})

async function challenge(publicKey: KeyObject = keys.publicKey) {
  const response = await api('/auth/device/challenge', {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string; message: string }>
}
async function login(pair = keys) {
  const response = await api('/auth/device/verify', signed(await challenge(pair.publicKey), pair.privateKey))
  expect(response.status).toBe(201)
  return response.json() as Promise<{ token: string; userId: string }>
}

test('device login needs no wallet data and cannot grant service privileges', async () => {
  const session = await login()
  expect((await api('/me', undefined, session.token)).status).toBe(200)
  expect((await api('/users', undefined, session.token)).status).toBe(401)
  expect((await api('/referrals/codes', { ownerAddress: 'victim' }, session.token)).status).toBe(401)
  expect(
    (await api('/me/devices', { userId: 'victim', deviceToken: 'test', deviceType: 'WEB' }, session.token)).status,
  ).toBe(400)
  expect((await api('/me/devices', { deviceToken: 'test', deviceType: 'WEB' }, session.token)).status).toBe(201)
  expect(registerDevice).toHaveBeenCalledWith({ userId: session.userId, deviceToken: 'test', deviceType: 'WEB' })
})

test('different installations have separate profiles; the same key recovers only its own profile', async () => {
  const a = await login()
  const b = await login(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }))
  const again = await login()
  expect(a.userId).not.toBe(b.userId)
  expect(again.userId).toBe(a.userId)
  expect(await (await api('/me', undefined, b.token)).json()).toEqual({ id: b.userId })
  expect((await api(`/users/${a.userId}`, undefined, b.token)).status).toBe(401)
})

test('a replayed or concurrent proof produces only one session', async () => {
  const proof = signed(await challenge())
  const responses = await Promise.all([api('/auth/device/verify', proof), api('/auth/device/verify', proof)])
  expect(responses.map((result) => result.status).sort()).toEqual([201, 401])
  expect(sessions.size).toBe(1)
})

test('rejects a different key, origin, expired challenge and client-supplied identity', async () => {
  const data = await challenge()
  expect(
    (await api('/auth/device/verify', signed(data, generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey)))
      .status,
  ).toBe(401)
  expect((await api('/auth/device/verify', signed(data), undefined, 'https://evil.example')).status).toBe(401)
  expect((await api('/auth/device/verify', { ...signed(data), userId: 'victim' })).status).toBe(400)
  challenges.get(data.id).expiresAt = new Date(0)
  expect((await api('/auth/device/verify', signed(data))).status).toBe(401)
})

test('logout invalidates a session', async () => {
  const session = await login()
  expect((await api('/auth/device/session', undefined, session.token, origin, 'DELETE')).status).toBe(200)
  expect((await api('/me', undefined, session.token)).status).toBe(401)
})

test('mobile registration requires receipt of the secret delivered to that push token', async () => {
  const a = await login()
  const b = await login(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }))
  const response = await api('/me/devices', { deviceToken: 'ExpoPushToken[testing]', deviceType: 'MOBILE' }, a.token)
  const pending = (await response.json()) as { registrationId: string; nonce?: string }
  expect(pending.nonce).toBeUndefined()
  expect(deviceUpsert).not.toHaveBeenCalled()
  const deliveredProof = delivered.mock.calls[0][0]
  const proof = { registrationId: pending.registrationId, nonce: deliveredProof.nonce }
  expect((await api('/me/devices/confirm', proof, b.token)).status).toBe(400)
  expect((await api('/me/devices/confirm', { ...proof, nonce: '00'.repeat(32) }, a.token)).status).toBe(400)
  expect((await api('/me/devices/confirm', proof, a.token)).status).toBe(201)
  expect(deviceUpsert).toHaveBeenCalledWith(
    expect.objectContaining({ update: { userId: a.userId, deviceType: 'MOBILE', isActive: true } }),
  )
  expect((await api('/me/devices/confirm', proof, a.token)).status).toBe(400)
})
