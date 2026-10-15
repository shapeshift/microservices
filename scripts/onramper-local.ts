import 'reflect-metadata'

import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { createServer } from 'node:http'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { OnramperCatalogue, OnramperController } from '../apps/user-service/src/onramper/onramper.controller'
import {
  OnramperAuthController,
  OnramperSessions,
  WalletProofVerifier,
} from '../apps/user-service/src/onramper/wallet-auth'
import { PrismaService } from '../apps/user-service/src/prisma/prisma.service'
import { SecurityRateLimiter } from '../packages/shared-utils'

const providerPort = 3999
const apiPort = 3002
const origins = ['http://localhost:5173', 'http://127.0.0.1:5173']
const keyPair = generateKeyPairSync('ed25519')
const seenNonces = new Map<string, number>()
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

if (process.env.NODE_ENV === 'production') throw new Error('The local simulator cannot run in production')
process.env.NODE_ENV = 'development'
const databaseUrl =
  process.env.ONRAMPER_LOCAL_DATABASE_URL ?? 'postgresql://onramper:local-test-only@127.0.0.1:55439/onramper_local'
const database = new URL(databaseUrl)
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.pathname !== '/onramper_local')
  throw new Error('The simulator requires a local database named onramper_local')
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  ONRAMPER_CHECKOUT_ENABLED: 'true',
  ONRAMPER_API_KEY: 'local-test-only',
  ONRAMPER_V2_PRIVATE_KEY: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ONRAMPER_API_URL: `http://localhost:${providerPort}/`,
  ONRAMPER_WIDGET_URL: `http://localhost:${providerPort}/`,
  ONRAMPER_ALLOWED_ORIGINS: origins.join(','),
  ONRAMPER_REDIRECT_ORIGINS: origins.join(','),
  ONRAMPER_EVM_RPC_URLS: '{}',
  TRUSTED_PROXY_IPS: '',
})

const provider = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  if (origins.includes(request.headers.origin ?? ''))
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }
  const url = new URL(request.url, `http://localhost:${providerPort}`)
  const json = (data: unknown) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(data))
  }
  if (url.pathname === '/supported') {
    json({
      message: {
        crypto: [
          {
            id: 'eth',
            code: 'ETH',
            symbol: 'ETH',
            name: 'Ethereum',
            network: 'ethereum',
            chainId: 1,
            decimals: 18,
            icon: '',
          },
        ],
        fiat: [{ id: 'usd', code: 'USD', symbol: '$', name: 'US Dollar', icon: '' }],
      },
    })
    return
  }
  if (url.pathname.startsWith('/quotes/')) {
    const amount = Number(url.searchParams.get('amount') ?? 100)
    json([
      {
        quoteId: 'local-demo',
        rate: 2000,
        payout: url.searchParams.get('type') === 'sell' ? amount * 2000 : amount / 2000,
        transactionFee: 0,
        networkFee: 0,
        availablePaymentMethods: [{ paymentTypeId: 'creditcard' }],
      },
    ])
    return
  }
  if (url.pathname !== '/') {
    response.writeHead(404).end()
    return
  }
  if (!url.searchParams.has('sigV2')) {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<h1>Local Onramper simulator</h1><p>Open the trading app at <a href="http://localhost:5173">localhost:5173</a>, connect an EVM wallet, choose ETH and USD, and select Onramper. No purchase or transfer is made.</p>',
    )
    return
  }
  const fields = new URLSearchParams()
  for (const name of (url.searchParams.get('sigV2Fields') ?? '').split(','))
    fields.set(name, url.searchParams.get(name) ?? '')
  fields.sort()
  const timestamp = url.searchParams.get('sigV2Timestamp') ?? ''
  const nonce = url.searchParams.get('sigV2Nonce') ?? ''
  const expiry = Date.parse(url.searchParams.get('sigV2Expiry') ?? '')
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
  const signature = url.searchParams.get('sigV2') ?? ''
  const now = Date.now()
  for (const [key, expiryTime] of seenNonces) if (expiryTime < now) seenNonces.delete(key)
  const valid =
    signature.startsWith('v2:') &&
    Number.isFinite(expiry) &&
    expiry > now &&
    expiry <= now + 5 * 60_000 &&
    Math.abs(now - Date.parse(timestamp)) < 5 * 60_000 &&
    /^[a-f0-9-]{36}$/.test(nonce) &&
    !seenNonces.has(nonce) &&
    fields.get('isAddressEditable') === 'false' &&
    verify(null, Buffer.from(payload), keyPair.publicKey, Buffer.from(signature.slice(3), 'base64'))
  if (!valid) {
    response.writeHead(401).end('Invalid, expired, modified, or previously used checkout signature')
    return
  }
  seenNonces.set(nonce, expiry)
  response.setHeader('Content-Type', 'text/html')
  const detail = (label: string, field: string) =>
    `<p><strong>${label}:</strong> ${escapeHtml(fields.get(field) ?? '')}</p>`
  response.end(
    `<h1>Wallet-authorized checkout passed</h1><p>Local simulation only. No purchase or transfer was made.</p>${detail('Wallet', 'wallets')}${detail('Action', 'mode')}${detail('Fiat', 'defaultFiat')}${detail('Amount', fields.get('mode') === 'sell' ? 'sell_defaultAmount' : 'defaultAmount')}<p>The server signature is valid and this checkout nonce has been consumed.</p>`,
  )
})

@Module({
  controllers: [OnramperController, OnramperAuthController],
  providers: [
    { provide: PrismaService, useFactory: () => new PrismaService({ datasourceUrl: databaseUrl }) },
    OnramperCatalogue,
    OnramperSessions,
    WalletProofVerifier,
    SecurityRateLimiter,
    { provide: 'SECURITY_DB', useExisting: PrismaService },
  ],
})
class LocalOnramperModule {}

async function main() {
  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject)
    provider.listen(providerPort, '127.0.0.1', resolve)
  })
  const app = await NestFactory.create(LocalOnramperModule, { logger: ['error', 'warn'] })
  app.enableCors({ origin: origins, allowedHeaders: ['Content-Type', 'Authorization'] })
  app
    .getHttpAdapter()
    .get('/health', (_, response: { json: (value: unknown) => void }) =>
      response.json({ status: 'ok', simulator: true }),
    )
  await app.listen(apiPort, '127.0.0.1')
  console.log(`Local wallet-auth API: http://localhost:${apiPort}`)
  console.log(`Local provider simulator: http://localhost:${providerPort}`)
  console.log('Frontend: use the onramper:local command in the web worktree. The simulator supports ETH / USD.')
  const stop = async () => {
    provider.close()
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => {
    void stop()
  })
  process.on('SIGTERM', () => {
    void stop()
  })
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local startup failed')
  provider.close()
  process.exitCode = 1
})
