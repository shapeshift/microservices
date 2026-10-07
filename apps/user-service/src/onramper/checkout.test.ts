import 'reflect-metadata'

import { generateKeyPairSync } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { HttpException } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { SecurityRateLimiter } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

import { OnramperCatalogue, OnramperController } from './onramper.controller'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

const intents = new Map<string, { id: string; tokenHash: string; origin: string; checkout: unknown; expiresAt: Date }>()
const db = {
  onramperIntent: {
    create: ({ data }: { data: typeof intents extends Map<string, infer V> ? V : never }) => {
      intents.set(data.id, data)
      return data
    },
    findUnique: ({ where }: { where: { id: string } }) => intents.get(where.id),
    deleteMany: ({ where }: { where: { id?: string } }) => ({ count: where.id ? Number(intents.delete(where.id)) : 0 }),
  },
}
const consume = jest.fn()
const catalogue = {
  get: jest.fn(() => Promise.resolve({ message: { crypto: [{ id: 'eth' }], fiat: [{ code: 'USD' }] } })),
}
let app: INestApplication
let base: string
const origin = 'https://app.shapeshift.com'
const checkout = {
  crypto: 'eth',
  address: '0x' + '11'.repeat(20),
  fiat: 'USD',
  action: 'buy',
  amount: '100',
  language: 'en',
  theme: 'light',
}
const post = (path: string, body: unknown, requestOrigin = origin) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: requestOrigin },
    body: JSON.stringify(body),
  })

beforeAll(async () => {
  process.env.ONRAMPER_ALLOWED_ORIGINS = origin
  process.env.ONRAMPER_API_KEY = 'test-integration'
  process.env.ONRAMPER_PRIVATE_KEY = generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  const module = await Test.createTestingModule({
    controllers: [OnramperController],
    providers: [
      { provide: SecurityRateLimiter, useValue: { consume } },
      { provide: OnramperCatalogue, useValue: catalogue },
      { provide: PrismaService, useValue: db },
    ],
  }).compile()
  app = module.createNestApplication()
  await app.listen(0, '127.0.0.1')
  base = await app.getUrl()
})
afterAll(async () => app?.close())
beforeEach(() => {
  intents.clear()
  consume.mockReset()
  catalogue.get.mockClear()
})
async function intent() {
  const response = await post('/onramper/intents', checkout)
  expect(response.status).toBe(201)
  return response.json() as Promise<{ id: string; token: string }>
}

test('guest checkout preserves functionality without a wallet login or secret exposure', async () => {
  const issued = await intent()
  expect(intents.get(issued.id)?.tokenHash).not.toBe(issued.token)
  const response = await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token })
  expect(response.status).toBe(201)
  const data = (await response.json()) as { url: string }
  expect(data.url).toContain('sigV2=')
  expect(data.url).not.toContain('PRIVATE')
})

test('the server signs the stored intent; clients cannot replace checkout fields', async () => {
  const issued = await intent()
  expect(
    (await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token, address: 'attacker' })).status,
  ).toBe(400)
  expect((await post(`/onramper/intents/${issued.id}/checkout`, { token: '00'.repeat(32) })).status).toBe(401)
  expect(
    (await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }, 'https://evil.example')).status,
  ).toBe(401)
})

test('an intent can be redeemed only once under concurrent requests', async () => {
  const issued = await intent()
  const responses = await Promise.all([
    post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }),
    post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token }),
  ])
  expect(responses.map((response) => response.status).sort()).toEqual([201, 401])
})

test('expired intents and unsupported provider currencies are rejected', async () => {
  const issued = await intent()
  intents.get(issued.id).expiresAt = new Date(0)
  expect((await post(`/onramper/intents/${issued.id}/checkout`, { token: issued.token })).status).toBe(401)
  expect((await post('/onramper/intents', { ...checkout, crypto: 'unsupported' })).status).toBe(400)
})

test('quota denial happens before provider work', async () => {
  consume.mockRejectedValueOnce(new HttpException('Too many requests', 429))
  expect((await post('/onramper/intents', checkout)).status).toBe(429)
  expect(catalogue.get).not.toHaveBeenCalled()
})
