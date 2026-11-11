import { clientIp } from '@shapeshift/shared-utils'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))

test('ignores untrusted forwarding headers', () => {
  expect(clientIp('192.0.2.1', '198.51.100.1', [])).toBe('192.0.2.1')
})
test('takes the first untrusted hop from the right, excluding forged leftmost values', () => {
  expect(clientIp('192.0.2.1', '198.51.100.2, 198.51.100.3', ['192.0.2.1'])).toBe('198.51.100.3')
})
test('rejects malformed proxy chains', () => {
  expect(clientIp('192.0.2.1', 'forged', ['192.0.2.1'])).toBe('192.0.2.1')
})
