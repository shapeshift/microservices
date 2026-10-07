import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { BadRequestException, Body, Controller, Delete, Header, Post, Req, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { z } from 'zod'

import type { UserRequest } from '@shapeshift/shared-utils'
import {
  allowedOrigins,
  clientIp,
  DeviceAccess,
  hashToken,
  PublicAccess,
  SecurityRateLimiter,
} from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

const challengeSchema = z.strictObject({
  publicKey: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .max(200),
})
const proofSchema = z.strictObject({ id: z.uuid(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) })

@Controller('auth/device')
export class DeviceAuthController {
  constructor(
    private readonly db: PrismaService,
    private readonly limits: SecurityRateLimiter,
  ) {}

  @Post('challenge')
  @Header('Cache-Control', 'no-store')
  @PublicAccess()
  async challenge(@Body() input: unknown, @Req() request: Request) {
    const parsed = challengeSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid device key')
    const origin = request.headers.origin
    if (!origin || !allowedOrigins().includes(origin)) throw new BadRequestException('Unsupported application origin')
    await this.limits.consume('device-auth-global', 'all', 1000)
    await this.limits.consume(
      'device-auth-ip',
      clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
      20,
    )
    let publicKey: string
    try {
      const key = createPublicKey({ key: Buffer.from(parsed.data.publicKey, 'base64'), type: 'spki', format: 'der' })
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
        throw new Error('Wrong key type')
      publicKey = key.export({ type: 'spki', format: 'der' }).toString('base64')
    } catch {
      throw new BadRequestException('Expected a P-256 public key')
    }
    const keyId = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex')
    const id = randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 5 * 60_000)
    const message = `ShapeShift device authentication\nOrigin: ${origin}\nDevice: ${keyId}\nNonce: ${id}\nExpires: ${expiresAt.toISOString()}`
    await this.db.deviceChallenge.deleteMany({ where: { expiresAt: { lt: now } } })
    await this.db.deviceSession.deleteMany({ where: { expiresAt: { lt: now } } })
    await this.db.securityRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * 60_000) } } })
    await this.db.deviceChallenge.create({ data: { id, keyId, publicKey, message, origin, expiresAt } })
    return { id, message, expiresAt: expiresAt.toISOString() }
  }

  @Post('verify')
  @Header('Cache-Control', 'no-store')
  @PublicAccess()
  async verify(@Body() input: unknown, @Req() request: Request) {
    const parsed = proofSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid device proof')
    await this.limits.consume('device-verify-global', 'all', 1000)
    await this.limits.consume(
      'device-verify-ip',
      clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
      30,
    )
    const challenge = await this.db.deviceChallenge.findUnique({ where: { id: parsed.data.id } })
    if (
      !challenge ||
      challenge.expiresAt <= new Date() ||
      challenge.origin !== request.headers.origin ||
      !allowedOrigins().includes(challenge.origin)
    )
      throw new UnauthorizedException('Invalid or expired challenge')
    const key = createPublicKey({ key: Buffer.from(challenge.publicKey, 'base64'), type: 'spki', format: 'der' })
    if (
      !verify(
        'sha256',
        Buffer.from(challenge.message),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(parsed.data.signature, 'base64'),
      )
    )
      throw new UnauthorizedException('Invalid device signature')
    const identity = await this.db.deviceIdentity.findUnique({ where: { keyId: challenge.keyId } })
    if (!identity) {
      await this.limits.consume('device-registration-global', 'all', 10000, 86400)
      await this.limits.consume(
        'device-registration-ip',
        clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
        10,
        3600,
      )
    }
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
    const complete = () =>
      this.db.$transaction(async (tx) => {
        const consumed = await tx.deviceChallenge.deleteMany({
          where: { id: challenge.id, expiresAt: { gt: new Date() } },
        })
        if (consumed.count !== 1) throw new UnauthorizedException('Challenge already used')
        const identity = await tx.deviceIdentity.upsert({
          where: { keyId: challenge.keyId },
          update: {},
          create: { keyId: challenge.keyId, user: { create: {} } },
        })
        await tx.deviceSession.create({ data: { tokenHash: hashToken(token), userId: identity.userId, expiresAt } })
        return identity.userId
      })
    const userId = await complete().catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return complete()
      throw error
    })
    return { userId, token, expiresAt: expiresAt.toISOString() }
  }

  @Delete('session')
  @DeviceAccess()
  async logout(@Req() request: UserRequest) {
    const token = (request.headers.authorization as string).slice(7)
    await this.db.deviceSession.deleteMany({ where: { tokenHash: hashToken(token), userId: request.userId } })
    return { success: true }
  }
}
