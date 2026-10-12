import { clientIp } from './client-ip'

test('ignores forwarded headers from an untrusted mapped socket', () => {
  expect(clientIp('::ffff:192.0.2.1', '198.51.100.5', [])).toBe('192.0.2.1')
})
test('matches mapped sockets against IPv4 trusted proxies', () => {
  expect(clientIp('::ffff:192.0.2.1', '198.51.100.5', ['192.0.2.1'])).toBe('198.51.100.5')
})
test('normalizes trusted proxies and forwarded mapped hops', () => {
  expect(clientIp('192.0.2.1', '::ffff:c633:6405, ::ffff:192.0.2.2', ['::ffff:c000:201', '192.0.2.2'])).toBe(
    '198.51.100.5',
  )
})
test('selects the nearest untrusted hop rather than a spoofed leading address', () => {
  expect(clientIp('192.0.2.1', '203.0.113.9, 198.51.100.5, ::ffff:192.0.2.2', ['192.0.2.1', '192.0.2.2'])).toBe(
    '198.51.100.5',
  )
})
test('rejects invalid and oversized forwarded chains', () => {
  expect(clientIp('::ffff:192.0.2.1', 'invalid', ['192.0.2.1'])).toBe('192.0.2.1')
  expect(clientIp('192.0.2.1', Array(11).fill('198.51.100.5').join(','), ['192.0.2.1'])).toBe('192.0.2.1')
})
test('canonicalizes native IPv6 addresses for consistent quota identity', () => {
  expect(clientIp('2001:0db8:0:0:0:0:0:1', undefined, [])).toBe('2001:db8::1')
})
test('preserves the unknown fallback for missing or invalid sockets', () => {
  expect(clientIp(undefined, '198.51.100.5', [])).toBe('unknown')
  expect(clientIp('invalid', '198.51.100.5', [])).toBe('unknown')
})
