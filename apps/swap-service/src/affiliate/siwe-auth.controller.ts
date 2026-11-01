import { BadRequestException, Body, Controller, Post, UnauthorizedException } from '@nestjs/common'
import * as crypto from 'crypto'
import * as jwt from 'jsonwebtoken'
import { SiweMessage } from 'siwe'

import { env } from '../env'
import { PrismaService } from '../prisma/prisma.service'

import { assertSiwePolicy, NONCE_EXPIRY_MS, SIWE_TOKEN_AUDIENCE, SIWE_TOKEN_ISSUER } from './siwe-policy'

@Controller('v1/auth/siwe')
export class SiweAuthController {
  private readonly jwtSecret = env.SIWE_JWT_SECRET

  constructor(private readonly prisma: PrismaService) {}

  @Post('nonce')
  async generateNonce(): Promise<{ nonce: string }> {
    const now = new Date()
    await this.prisma.siweNonce.deleteMany({ where: { expiresAt: { lte: now } } })
    const nonce = crypto.randomBytes(16).toString('hex')
    await this.prisma.siweNonce.create({
      data: { nonce, createdAt: now, expiresAt: new Date(now.getTime() + NONCE_EXPIRY_MS) },
    })
    return { nonce }
  }

  @Post('verify')
  async verify(@Body() body: { message: string; signature: string }): Promise<{ token: string; address: string }> {
    if (
      typeof body?.message !== 'string' ||
      body.message.length > 4096 ||
      typeof body.signature !== 'string' ||
      !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(body.signature)
    ) {
      throw new BadRequestException('Invalid message or signature')
    }
    const message = (() => {
      try {
        return new SiweMessage(body.message)
      } catch {
        throw new BadRequestException('Invalid SIWE message format')
      }
    })()
    const now = new Date()
    try {
      assertSiwePolicy(message, env.SIWE_ALLOWED_ORIGINS, now.getTime())
    } catch {
      throw new UnauthorizedException('Invalid SIWE application or message lifetime')
    }

    // Deletion is atomic across replicas and consumes the challenge before asynchronous verification.
    const consumed = await this.prisma.siweNonce.deleteMany({
      where: { nonce: message.nonce, expiresAt: { gt: now }, createdAt: { lte: now } },
    })
    if (consumed.count !== 1) throw new UnauthorizedException('Invalid or expired nonce')
    try {
      const result = await message.verify({
        signature: body.signature,
        domain: message.domain,
        nonce: message.nonce,
        time: now.toISOString(),
      })
      if (!result.success) throw new Error('Invalid signature')
    } catch {
      throw new UnauthorizedException('Invalid signature')
    }

    const address = message.address.toLowerCase()
    const token = jwt.sign({ address }, this.jwtSecret, {
      expiresIn: '24h',
      algorithm: 'HS256',
      issuer: SIWE_TOKEN_ISSUER,
      audience: SIWE_TOKEN_AUDIENCE,
    })
    return { token, address }
  }
}
