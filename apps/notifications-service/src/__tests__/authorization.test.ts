import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../app.module'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { WebsocketGateway } from '../websocket/websocket.gateway'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

let app: INestApplication
let baseUrl: string
beforeAll(async () => {
  process.env.SERVICE_API_KEY = 'test-only-internal-service-key'
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(NotificationsService)
    .useValue({ getUserNotifications: () => [] })
    .overrideProvider(WebsocketGateway)
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
  ['POST', '/notifications/send-to-user'],
  ['POST', '/notifications/send-to-device'],
  ['POST', '/notifications/register-device'],
  ['GET', '/notifications/user/victim'],
])('anonymous %s %s is rejected by the real HTTP guard', async (method, path) => {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
  expect(response.status).toBe(401)
})

test('a wrong service credential is rejected', async () => {
  const response = await fetch(baseUrl + '/notifications/user/victim', { headers: { 'x-api-key': 'incorrect' } })
  expect(response.status).toBe(401)
})

test('an authenticated service can read notifications', async () => {
  const response = await fetch(baseUrl + '/notifications/user/victim', {
    headers: { 'x-api-key': 'test-only-internal-service-key' },
  })
  expect(response.status).toBe(200)
})
