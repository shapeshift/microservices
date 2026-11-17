import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { inspect } from 'node:util'

import { NotificationsServiceClient, ServiceRequestError } from '@shapeshift/shared-utils'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

test('a failed internal call does not expose the service key or payload in its error', async () => {
  const server = createServer((_, response) => {
    response.statusCode = 400
    response.end('{"message":"rejected"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.NOTIFICATIONS_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.SERVICE_API_KEY = 'secret-service-key-for-test'
  const body = 'payload-text-that-must-not-be-logged'
  try {
    const error: unknown = await new NotificationsServiceClient()
      .createNotification({ userId: 'user', title: 'Swap', body, type: 'SWAP_COMPLETED' as never })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ServiceRequestError)
    expect((error as ServiceRequestError).status).toBe(400)
    const logged = inspect(error, { depth: 10 })
    expect(logged).not.toContain('secret-service-key-for-test')
    expect(logged).not.toContain(body)
  } finally {
    server.close()
  }
})
