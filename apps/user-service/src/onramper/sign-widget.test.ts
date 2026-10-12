import { createHash, generateKeyPairSync, verify } from 'node:crypto'

import { checkoutSchema, signWidgetUrl } from './sign-widget'

const pair = generateKeyPairSync('ed25519')
const config = {
  apiKey: 'public-test-integration',
  privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  widgetUrl: 'https://buy.onramper.com',
  redirectOrigins: ['https://app.shapeshift.com'],
}
const checkout = checkoutSchema.parse({
  crypto: 'eth',
  address: '0x1234567890123456789012345678901234567890',
  fiat: 'USD',
  action: 'buy',
  amount: '100',
  language: 'en',
  theme: 'dark',
  redirectUrl: 'https://app.shapeshift.com/',
})

function validSignature(url: URL): boolean {
  const fields = new URLSearchParams()
  for (const name of url.searchParams.get('sigV2Fields').split(',')) fields.set(name, url.searchParams.get(name))
  fields.sort()
  const payload = [
    'ONRAMPER-SIG-V2',
    url.searchParams.get('sigV2Timestamp'),
    url.searchParams.get('sigV2Nonce'),
    'GET',
    '/',
    fields.toString(),
    '',
    createHash('sha256').update('').digest('hex'),
  ].join('\n')
  return verify(
    null,
    Buffer.from(payload),
    pair.publicKey,
    Buffer.from(url.searchParams.get('sigV2').slice(3), 'base64'),
  )
}

test('signs all checkout fields with the server private key and a fresh short-lived URL', () => {
  const now = new Date('2026-10-07T00:00:00Z')
  const a = new URL(signWidgetUrl(checkout, config, now))
  const b = new URL(signWidgetUrl(checkout, config, now))
  expect(validSignature(a)).toBe(true)
  expect(a.searchParams.get('sigV2Expiry')).toBe('2026-10-07T00:05:00.000Z')
  expect(a.searchParams.get('sigV2Nonce')).not.toBe(b.searchParams.get('sigV2Nonce'))
  expect(a.href).not.toContain('PRIVATE')
  a.searchParams.set('wallets', 'eth:attacker')
  expect(validSignature(a)).toBe(false)
})

test('preserves sell configuration and signs it', () => {
  const url = new URL(signWidgetUrl({ ...checkout, action: 'sell' }, config))
  expect(validSignature(url)).toBe(true)
  expect(url.searchParams.get('sell_defaultAmount')).toBe('100')
  url.searchParams.set('sell_defaultAmount', '999')
  expect(validSignature(url)).toBe(false)
})

test.each([
  { ...checkout, apiKey: 'attacker' },
  { ...checkout, signature: 'attacker' },
  { ...checkout, address: 'address,btc:attacker' },
  { ...checkout, crypto: 'eth&apiKey=attacker' },
  { ...checkout, amount: '-1' },
  { ...checkout, amount: '1e99' },
])('rejects unexpected or malformed signing input', (value) => {
  expect(checkoutSchema.safeParse(value).success).toBe(false)
})

test.each([
  'https://evil.example/',
  'https://app.shapeshift.com.evil.example/',
  'https://attacker@app.shapeshift.com/',
])('rejects redirect %s', (redirectUrl) => {
  expect(() => signWidgetUrl({ ...checkout, redirectUrl }, config)).toThrow('Redirect')
})
