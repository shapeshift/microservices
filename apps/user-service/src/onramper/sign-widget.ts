import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { z } from 'zod'

const amount = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,18})?$/)
  .refine((value) => Number(value) > 0)
export const checkoutSchema = z.strictObject({
  crypto: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  address: z.string().regex(/^[a-zA-Z0-9:]{1,150}$/),
  fiat: z.string().regex(/^[A-Z]{3}$/),
  action: z.enum(['buy', 'sell']),
  amount: amount.optional(),
  language: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  theme: z.enum(['light', 'dark']),
  redirectUrl: z.url().max(2048).optional(),
})
export type Checkout = z.infer<typeof checkoutSchema>
export type SigningConfig = {
  apiKey: string
  privateKey: string
  widgetUrl: string
  redirectOrigins: string[]
}

export function signWidgetUrl(checkout: Checkout, config: SigningConfig, now = new Date()): string {
  const key = createPrivateKey(config.privateKey)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Onramper requires an Ed25519 key')
  const url = new URL(config.widgetUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Invalid Onramper widget URL')
  const fields = new URLSearchParams({
    apiKey: config.apiKey,
    wallets: `${checkout.crypto}:${checkout.address}`,
    mode: checkout.action,
    defaultCrypto: checkout.crypto,
    onlyCryptos: checkout.crypto,
    defaultFiat: checkout.fiat,
    ...(checkout.amount ? { defaultAmount: checkout.amount } : {}),
  })
  if (checkout.action === 'sell') {
    fields.set('sell_defaultCrypto', checkout.crypto)
    fields.set('sell_onlyCryptos', checkout.crypto)
    fields.set('sell_defaultFiat', checkout.fiat)
    if (checkout.amount) fields.set('sell_defaultAmount', checkout.amount)
  }
  if (checkout.redirectUrl) {
    const redirect = new URL(checkout.redirectUrl)
    if (!config.redirectOrigins.includes(redirect.origin) || redirect.username || redirect.password)
      throw new Error('Redirect is not allowed')
    fields.set('successRedirectUrl', redirect.href)
    fields.set('failureRedirectUrl', redirect.href)
  }
  fields.sort()
  const timestamp = now.toISOString()
  const nonce = randomUUID()
  const payload = [
    'ONRAMPER-SIG-V2',
    timestamp,
    nonce,
    'GET',
    '/',
    fields.toString(),
    '',
    createHash('sha256').update('').digest('hex'),
  ].join('\n')
  url.search = fields.toString()
  url.searchParams.set('sigV2', `v2:${sign(null, Buffer.from(payload), key).toString('base64')}`)
  url.searchParams.set('sigV2Timestamp', timestamp)
  url.searchParams.set('sigV2Nonce', nonce)
  url.searchParams.set('sigV2Expiry', new Date(now.getTime() + 5 * 60_000).toISOString())
  url.searchParams.set('sigV2Fields', [...fields.keys()].join(','))
  url.searchParams.set('language', checkout.language)
  url.searchParams.set('themeName', checkout.theme)
  return url.href
}
