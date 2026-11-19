import { NotificationsService } from '../notifications/notifications.service'
import { hasServiceKey, WebsocketGateway } from '../websocket/websocket.gateway'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

test('a push failure after the notification is stored does not fail the request', async () => {
  process.env.EXPO_ACCESS_TOKEN = 'test-only-expo-token'
  const stored = { id: 'stored', userId: 'owner', title: 'Swap', body: 'Done', type: 'SWAP_COMPLETED', swapId: null }
  const create = jest.fn().mockResolvedValue(stored)
  const service = new NotificationsService({ notification: { create } } as never, {} as never)
  jest.spyOn(service, 'sendPushNotification').mockRejectedValue(new Error('user-service unavailable'))

  await expect(
    service.createNotification({ userId: 'owner', title: 'Swap', body: 'Done', type: 'SWAP_COMPLETED' as never }),
  ).resolves.toBe(stored)
  expect(create).toHaveBeenCalledTimes(1)
})

test('WebSocket handshakes need the service key', () => {
  process.env.SERVICE_API_KEY = 'test-only-internal-service-key'
  let middleware: (socket: unknown, next: (error?: Error) => void) => void = () => undefined
  new WebsocketGateway({} as never).afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never)
  const handshake = (headers: Record<string, string>) => {
    let result: Error | undefined
    middleware({ handshake: { headers } }, (error) => (result = error))
    return result
  }

  expect(handshake({})).toBeInstanceOf(Error)
  expect(handshake({ 'x-api-key': 'incorrect' })).toBeInstanceOf(Error)
  expect(handshake({ 'x-api-key': 'test-only-internal-service-key' })).toBeUndefined()
  expect(hasServiceKey('anything', '')).toBe(false)
})
