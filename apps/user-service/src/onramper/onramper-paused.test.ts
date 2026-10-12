import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { SecurityRateLimiter } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

import { OnramperCatalogue, OnramperController } from './onramper.controller'
import { OnramperSessions } from './wallet-auth'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

let app: INestApplication
let base: string
const consume = jest.fn()
const get = jest.fn()
const findUnique = jest.fn()
const create = jest.fn()

beforeAll(async () => {
  delete process.env.ONRAMPER_CHECKOUT_ENABLED
  const module = await Test.createTestingModule({
    controllers: [OnramperController],
    providers: [
      { provide: OnramperSessions, useValue: { authenticate: jest.fn() } },
      { provide: SecurityRateLimiter, useValue: { consume } },
      { provide: OnramperCatalogue, useValue: { get } },
      { provide: PrismaService, useValue: { onramperIntent: { findUnique, create } } },
    ],
  }).compile()
  app = module.createNestApplication()
  await app.listen(0, '127.0.0.1')
  base = await app.getUrl()
})
afterAll(async () => app?.close())

test.each([
  ['/onramper/intents', undefined],
  ['/onramper/intents', 'https://app.shapeshift.com'],
  ['/onramper/intents/00000000-0000-4000-8000-000000000000/checkout', 'https://app.shapeshift.com'],
])('paused checkout rejects %s with origin %s before any provider or database work', async (path, origin) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ token: '00'.repeat(32) }),
  })
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ message: 'Onramper checkout is temporarily unavailable' })
  expect(consume).not.toHaveBeenCalled()
  expect(get).not.toHaveBeenCalled()
  expect(findUnique).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})
