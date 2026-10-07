import 'reflect-metadata'

import { EventEmitter } from 'node:events'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { DeviceSessions, hashToken, SecurityRateLimiter } from '@shapeshift/shared-utils'

import { AppModule } from '../app.module'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { WebsocketGateway } from '../websocket/websocket.gateway'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))
const token = 'ab'.repeat(32)
const reads = jest.fn((userId: string) => [{ id: 'notice', userId, title: 'Update' }])
const service = { getUserNotifications: reads, events: new EventEmitter() }
let revoked = false
const db = {
  deviceSession: {
    findUnique: ({ where }: { where: { tokenHash: string } }) =>
      !revoked && where.tokenHash === hashToken(token)
        ? { userId: 'owner', expiresAt: new Date(Date.now() + 60_000) }
        : null,
  },
}
let app: INestApplication
let base: string
beforeAll(async () => {
  process.env.SERVICE_API_KEY = 'test-service-key'
  process.env.DEVICE_ALLOWED_ORIGINS = 'https://app.shapeshift.com'
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .overrideProvider(NotificationsService)
    .useValue(service)
    .overrideProvider(SecurityRateLimiter)
    .useValue({ consume: jest.fn() })
    .overrideProvider(WebsocketGateway)
    .useValue({})
    .compile()
  app = module.createNestApplication()
  await app.listen(0, '127.0.0.1')
  base = await app.getUrl()
})
afterAll(async () => app?.close())
beforeEach(() => {
  revoked = false
  reads.mockClear()
})

test('a user can read only their own notifications and cannot send branded pushes', async () => {
  const headers = { authorization: `Bearer ${token}` }
  expect((await fetch(base + '/notifications/me?userId=victim', { headers })).status).toBe(200)
  expect(reads).toHaveBeenCalledWith('owner', 50)
  expect((await fetch(base + '/notifications/user/victim', { headers })).status).toBe(401)
  expect((await fetch(base + '/notifications/send-to-user', { method: 'POST', headers })).status).toBe(401)
  expect((await fetch(base + '/notifications/verify-device', { method: 'POST', headers })).status).toBe(401)
  expect((await fetch(base + '/notifications/me?limit=100000', { headers })).status).toBe(400)
  revoked = true
  expect((await fetch(base + '/notifications/me', { headers })).status).toBe(401)
})

test('WebSocket reads derive identity from the session and reject a revoked token', async () => {
  const sessions = new DeviceSessions(db as never)
  const gateway = new WebsocketGateway(service as never, sessions, {
    consume: jest.fn(),
  } as unknown as SecurityRateLimiter)
  const socket = { data: { token, userId: 'victim' }, disconnect: jest.fn() }
  expect(await gateway.handleGetNotifications({ limit: 5 }, socket as never)).toEqual({
    success: true,
    notifications: [{ id: 'notice', userId: 'owner', title: 'Update' }],
  })
  expect(reads).toHaveBeenCalledWith('owner', 5)
  revoked = true
  expect(await gateway.handleGetNotifications({ limit: 5 }, socket as never)).toEqual({ error: 'Sign in required' })
  expect(socket.disconnect).toHaveBeenCalledWith(true)
})

test('WebSocket connections ignore supplied user IDs and expire when the device session does', async () => {
  const sessions = new DeviceSessions(db as never)
  const gateway = new WebsocketGateway(service as never, sessions, {
    consume: jest.fn(),
  } as unknown as SecurityRateLimiter)
  const socket = {
    connected: true,
    handshake: { address: '127.0.0.1', headers: {}, auth: { token, userId: 'victim' } },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
  }
  await gateway.handleConnection(socket as never)
  expect(socket.join).toHaveBeenCalledWith('user:owner')
  gateway.handleDisconnect(socket as never)
  revoked = true
  await gateway.handleConnection(socket as never)
  expect(socket.disconnect).toHaveBeenCalledWith(true)
})

test('device verification sends only a short-lived data payload to Expo', async () => {
  process.env.EXPO_ACCESS_TOKEN = 'test-only-expo-token'
  const service = new NotificationsService({} as never, {} as never)
  const send = jest
    .spyOn(service['expo'], 'sendPushNotificationsAsync')
    .mockResolvedValue([{ status: 'ok', id: 'ticket' }])
  const data = {
    deviceToken: 'ExpoPushToken[test-only]',
    registrationId: '00000000-0000-4000-8000-000000000001',
    nonce: 'ab'.repeat(32),
  }
  await service.sendDeviceVerification(data)
  expect(send).toHaveBeenCalledWith([
    {
      to: data.deviceToken,
      _contentAvailable: true,
      ttl: 300,
      data: { type: 'DEVICE_VERIFICATION', registrationId: data.registrationId, nonce: data.nonce },
    },
  ])
  send.mockResolvedValue([{ status: 'error', message: 'rejected' }])
  await expect(service.sendDeviceVerification(data)).rejects.toThrow('Could not deliver device verification')
  send.mockRestore()
})
