import type { ExecutionContext } from '@nestjs/common'
import { Signature, Wallet } from 'ethers'
import * as jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'

import type { PrismaService } from '../../prisma/prisma.service'
import { SiweAuthController } from '../siwe-auth.controller'
import { SiweAuthGuard } from '../siwe-auth.guard'
import { assertSiwePolicy, SIWE_TOKEN_AUDIENCE, SIWE_TOKEN_ISSUER } from '../siwe-policy'

jest.mock('../../env', () => ({
  env: {
    SIWE_JWT_SECRET: 'test-secret-that-never-leaves-tests',
    SIWE_ALLOWED_ORIGINS: ['https://affiliate.shapeshift.com'],
  },
}))

const makeMessage = (address: string, nonce: string) =>
  new SiweMessage({
    domain: 'affiliate.shapeshift.com',
    address,
    uri: 'https://affiliate.shapeshift.com',
    version: '1',
    chainId: 42161,
    nonce,
    statement: 'Sign in to ShapeShift Affiliate Dashboard',
    issuedAt: new Date().toISOString(),
  })

function fixture() {
  const nonces = new Set<string>()
  const prisma = {
    siweNonce: {
      create: jest.fn(({ data }: { data: { nonce: string } }) => {
        nonces.add(data.nonce)
        return Promise.resolve()
      }),
      deleteMany: jest.fn(({ where }: { where: { nonce?: string } }) =>
        Promise.resolve({
          count: where.nonce && nonces.delete(where.nonce) ? 1 : 0,
        }),
      ),
    },
  } as unknown as PrismaService
  return new SiweAuthController(prisma)
}

test('correct signatures work and replay/concurrent redemption succeeds only once', async () => {
  const controller = fixture()
  const wallet = Wallet.createRandom()
  const { nonce } = await controller.generateNonce()
  const message = makeMessage(wallet.address, nonce).prepareMessage()
  const signature = await wallet.signMessage(message)
  const results = await Promise.allSettled([
    controller.verify({ message, signature }),
    controller.verify({ message, signature }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  await expect(controller.verify({ message, signature })).rejects.toThrow('nonce')
})

test('rejects a cryptographically valid signature naming another application', async () => {
  const controller = fixture()
  const wallet = Wallet.createRandom()
  const { nonce } = await controller.generateNonce()
  const siwe = makeMessage(wallet.address, nonce)
  siwe.domain = 'attacker.invalid'
  siwe.uri = 'https://attacker.invalid'
  const message = siwe.prepareMessage()
  await expect(controller.verify({ message, signature: await wallet.signMessage(message) })).rejects.toThrow(
    'application',
  )
})

test.each(['domain', 'uri', 'chain', 'statement', 'future', 'expired', 'resources'])(
  'rejects mismatched %s',
  (field) => {
    const message = makeMessage(Wallet.createRandom().address, 'a'.repeat(32))
    if (field === 'domain') message.domain = 'attacker.invalid'
    if (field === 'uri') message.uri += '/unexpected'
    if (field === 'chain') message.chainId = 1
    if (field === 'statement') message.statement = 'Sign in somewhere else'
    if (field === 'future') message.issuedAt = new Date(Date.now() + 60000).toISOString()
    if (field === 'expired') message.issuedAt = new Date(Date.now() - 600000).toISOString()
    if (field === 'resources') message.resources = ['https://attacker.invalid']
    expect(() => assertSiwePolicy(message, ['https://affiliate.shapeshift.com'], Date.now())).toThrow()
  },
)

test('old unscoped JWTs cannot authorize affiliate changes after upgrade', () => {
  const address = Wallet.createRandom().address
  const oldToken = jwt.sign({ address }, 'test-secret-that-never-leaves-tests', { expiresIn: '24h' })
  const request = { headers: { authorization: `Bearer ${oldToken}` } }
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext
  expect(() => new SiweAuthGuard().canActivate(context)).toThrow('Invalid or expired')
  const newToken = jwt.sign({ address }, 'test-secret-that-never-leaves-tests', {
    expiresIn: '24h',
    issuer: SIWE_TOKEN_ISSUER,
    audience: SIWE_TOKEN_AUDIENCE,
    algorithm: 'HS256',
  })
  request.headers.authorization = `Bearer ${newToken}`
  expect(new SiweAuthGuard().canActivate(context)).toBe(true)
})

test('accepts a valid compact EIP-2098 signature', async () => {
  const controller = fixture()
  const wallet = Wallet.createRandom()
  const { nonce } = await controller.generateNonce()
  const message = makeMessage(wallet.address, nonce).prepareMessage()
  const signature = Signature.from(await wallet.signMessage(message)).compactSerialized
  const response = await controller.verify({ message, signature })
  expect(response.address).toBe(wallet.address.toLowerCase())
})
