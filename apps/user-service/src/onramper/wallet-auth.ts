import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Header,
  Injectable,
  Post,
  Req,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { createPublicClient, getAddress, http, verifyMessage } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { z } from 'zod'

import type { OnramperSession } from '@shapeshift/prisma'
import { clientIp, SecurityRateLimiter } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

import { checkoutOrigins, evmNetworks, isAllowedUrl } from './config'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const chainIdSchema = z
  .number()
  .int()
  .positive()
  .refine((id) => Boolean(evmNetworks[id]))
const challengeSchema = z.strictObject({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: chainIdSchema,
})
const proofSchema = z.strictObject({
  id: z.uuid(),
  signature: z
    .string()
    .regex(/^0x(?:[a-fA-F0-9]{2})+$/)
    .max(32770),
})
export type WalletRequest = Request & { onramperSession: OnramperSession }

@Injectable()
export class WalletProofVerifier {
  async verify(proof: Pick<OnramperSession, 'address' | 'chainId' | 'message' | 'signature'>): Promise<boolean> {
    const address = proof.address as `0x${string}`
    const signature = proof.signature as `0x${string}`
    if (await verifyMessage({ address, message: proof.message, signature }).catch(() => false)) return true
    const rpcUrls = (() => {
      try {
        return z.record(z.string(), z.string()).parse(JSON.parse(process.env.ONRAMPER_EVM_RPC_URLS ?? '{}'))
      } catch {
        throw new ServiceUnavailableException('Invalid wallet verification configuration')
      }
    })()
    const rpc = rpcUrls[String(proof.chainId)]
    if (!rpc) return false
    if (!isAllowedUrl(rpc)) throw new ServiceUnavailableException('Invalid wallet verification configuration')
    const client = createPublicClient({ transport: http(rpc, { timeout: 10000, retryCount: 0 }), ccipRead: false })
    try {
      if ((await client.getChainId()) !== proof.chainId)
        throw new ServiceUnavailableException('Wallet verification network mismatch')
      return await client.verifyMessage({ address, message: proof.message, signature })
    } catch {
      throw new ServiceUnavailableException('Wallet verification unavailable')
    }
  }
}

@Injectable()
export class OnramperSessions {
  constructor(
    private readonly db: PrismaService,
    private readonly limits: SecurityRateLimiter,
    private readonly verifier: WalletProofVerifier,
  ) {}

  async authenticate(request: Request): Promise<OnramperSession> {
    await this.limits.consume(
      'onramper-auth-ip',
      clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
      60,
    )
    const header = request.headers.authorization
    const token = typeof header === 'string' && /^Bearer [a-f0-9]{64}$/.test(header) ? header.slice(7) : undefined
    if (!token) throw new UnauthorizedException('Wallet authentication required')
    const session = await this.db.onramperSession.findUnique({ where: { tokenHash: hashToken(token) } })
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.origin !== request.headers.origin ||
      !checkoutOrigins().includes(session.origin) ||
      !evmNetworks[session.chainId]
    )
      throw new UnauthorizedException('Invalid or expired wallet session')
    await this.limits.consume('onramper-user', `eip155:${session.chainId}:${session.address.toLowerCase()}`, 20)
    if (!(await this.verifier.verify(session)))
      throw new UnauthorizedException('Wallet authorization is no longer valid')
    return session
  }
}

@Injectable()
export class OnramperSessionGuard implements CanActivate {
  constructor(private readonly sessions: OnramperSessions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WalletRequest>()
    request.onramperSession = await this.sessions.authenticate(request)
    return true
  }
}

@Controller('onramper/auth')
@SetMetadata('public-access', true)
export class OnramperAuthController {
  constructor(
    private readonly db: PrismaService,
    private readonly limits: SecurityRateLimiter,
    private readonly verifier: WalletProofVerifier,
  ) {}

  private async limit(request: Request, scope: string) {
    await this.limits.consume(`${scope}-global`, 'all', 300)
    await this.limits.consume(
      scope,
      clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
      10,
    )
    const origin = request.headers.origin
    if (!origin || !checkoutOrigins().includes(origin)) throw new BadRequestException('Unsupported application origin')
    return origin
  }

  @Post('challenge')
  @Header('Cache-Control', 'no-store')
  async challenge(@Req() request: Request, @Body() input: unknown) {
    const origin = await this.limit(request, 'onramper-challenge')
    const parsed = challengeSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Unsupported wallet or network')
    const address = getAddress(parsed.data.address)
    if (address === '0x0000000000000000000000000000000000000000') throw new BadRequestException('Invalid wallet')
    await this.limits.consume('onramper-challenge-wallet', `eip155:${parsed.data.chainId}:${address.toLowerCase()}`, 10)
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + 5 * 60_000)
    const message = createSiweMessage({
      address,
      chainId: parsed.data.chainId,
      domain: new URL(origin).host,
      scheme: new URL(origin).protocol.slice(0, -1),
      uri: `${origin}/onramper`,
      version: '1',
      nonce: randomBytes(32).toString('hex'),
      expirationTime: expiresAt,
      requestId: id,
      statement:
        'Authorize ShapeShift Onramper checkout to this wallet. This does not authorize a blockchain transaction.',
    })
    await this.db.onramperChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await this.db.onramperSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await this.db.securityRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } } })
    await this.db.onramperChallenge.create({
      data: { id, origin, address, chainId: parsed.data.chainId, message, expiresAt },
    })
    return { id, message, expiresAt: expiresAt.toISOString() }
  }

  @Post('verify')
  @Header('Cache-Control', 'no-store')
  async verify(@Req() request: Request, @Body() input: unknown) {
    const origin = await this.limit(request, 'onramper-verify')
    const parsed = proofSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid wallet proof')
    const challenge = await this.db.onramperChallenge.findUnique({ where: { id: parsed.data.id } })
    if (!challenge || challenge.origin !== origin || challenge.expiresAt <= new Date())
      throw new UnauthorizedException('Invalid or expired wallet challenge')
    if (!(await this.verifier.verify({ ...challenge, signature: parsed.data.signature })))
      throw new UnauthorizedException('Invalid wallet signature')
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60_000)
    await this.db.$transaction(async (tx) => {
      const consumed = await tx.onramperChallenge.deleteMany({
        where: { id: challenge.id, expiresAt: { gt: new Date() } },
      })
      if (consumed.count !== 1) throw new UnauthorizedException('Wallet challenge already used')
      await tx.onramperSession.create({
        data: {
          id: randomUUID(),
          tokenHash: hashToken(token),
          address: challenge.address,
          chainId: challenge.chainId,
          origin,
          message: challenge.message,
          signature: parsed.data.signature,
          expiresAt,
        },
      })
    })
    return { token, address: challenge.address, chainId: challenge.chainId, expiresAt: expiresAt.toISOString() }
  }

  @Delete('session')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OnramperSessionGuard)
  async logout(@Req() request: WalletRequest) {
    await this.db.onramperSession.deleteMany({ where: { id: request.onramperSession.id } })
    return { success: true }
  }
}
