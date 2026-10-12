import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Injectable,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import axios from 'axios'
import { z } from 'zod'

import { clientIp, SecurityRateLimiter } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'

import { checkoutOrigins, evmNetworks, isAllowedUrl } from './config'
import { OnramperPausedGuard } from './onramper-paused.guard'
import { checkoutSchema, signWidgetUrl } from './sign-widget'
import type { WalletRequest } from './wallet-auth'
import { chainIdSchema, OnramperSessionGuard } from './wallet-auth'

const supportedSchema = z.object({
  message: z.object({
    crypto: z.array(z.object({ id: z.string(), network: z.string() })).max(20000),
    fiat: z.array(z.object({ code: z.string() })).max(500),
  }),
})
type Catalogue = z.infer<typeof supportedSchema>

@Injectable()
export class OnramperCatalogue {
  private cache?: { data: Catalogue; expiresAt: number }
  private pending?: Promise<Catalogue>

  async get(): Promise<Catalogue> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.data
    if (this.pending !== undefined) return this.pending
    this.pending = this.fetch().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async fetch(): Promise<Catalogue> {
    const baseUrl = process.env.ONRAMPER_API_URL ?? 'https://api.onramper.com/'
    const base = new URL(baseUrl)
    if (!isAllowedUrl(baseUrl) || base.username || base.password || base.search || base.hash)
      throw new ServiceUnavailableException('Invalid provider configuration')
    const response = await axios.get<unknown>(
      new URL('supported', base.href.endsWith('/') ? base.href : `${base.href}/`).href,
      {
        headers: { Authorization: process.env.ONRAMPER_API_KEY },
        timeout: 10000,
        maxRedirects: 0,
        maxContentLength: 2 * 1024 * 1024,
      },
    )
    const data = supportedSchema.parse(response.data)
    this.cache = { data, expiresAt: Date.now() + 60_000 }
    return data
  }
}

@Controller('onramper')
@SetMetadata('public-access', true)
@UseGuards(OnramperPausedGuard, OnramperSessionGuard)
export class OnramperController {
  constructor(
    private readonly limits: SecurityRateLimiter,
    private readonly catalogue: OnramperCatalogue,
    private readonly db: PrismaService,
  ) {}

  @Header('Cache-Control', 'no-store')
  @Post('intents')
  async createIntent(@Req() request: WalletRequest, @Body() input: unknown) {
    const parsed = checkoutSchema.omit({ address: true }).extend({ chainId: chainIdSchema }).safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid checkout request')
    await this.limits.consume('onramper-global', 'all', 1000)
    const origin = request.headers.origin
    if (!origin || !checkoutOrigins().includes(origin)) throw new BadRequestException('Unsupported application origin')
    await this.limits.consume(
      'onramper-ip',
      clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
      30,
    )
    const apiKey = process.env.ONRAMPER_API_KEY
    const privateKey = process.env.ONRAMPER_V2_PRIVATE_KEY
    if (!apiKey || !privateKey) throw new ServiceUnavailableException('Onramper signing is not configured')
    const session = request.onramperSession
    if (parsed.data.chainId !== session.chainId) throw new UnauthorizedException('Wallet network mismatch')
    const { chainId, ...details } = parsed.data
    const checkout = { ...details, address: session.address }
    const catalogue = await this.catalogue.get().catch(() => {
      throw new ServiceUnavailableException('Provider unavailable')
    })
    if (
      !catalogue.message.crypto.some(
        (crypto) => crypto.id === checkout.crypto && crypto.network === evmNetworks[chainId],
      ) ||
      !catalogue.message.fiat.some((fiat) => fiat.code.toUpperCase() === checkout.fiat)
    )
      throw new BadRequestException('Unsupported currency')
    if (checkout.redirectUrl) {
      const redirect = new URL(checkout.redirectUrl)
      const allowed = process.env.ONRAMPER_REDIRECT_ORIGINS?.split(',').map((value) => value.trim()) ?? []
      if (!allowed.includes(redirect.origin) || redirect.username || redirect.password)
        throw new BadRequestException('Redirect is not allowed')
    }
    const token = randomBytes(32).toString('hex')
    const id = randomUUID()
    const expiresAt = new Date(Math.min(Date.now() + 5 * 60_000, session.expiresAt.getTime()))
    await this.db.onramperIntent.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    await this.db.onramperIntent.create({
      data: {
        id,
        sessionId: session.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        origin,
        checkout,
        expiresAt,
      },
    })
    return { id, token, expiresAt: expiresAt.toISOString() }
  }

  @Header('Cache-Control', 'no-store')
  @Post('intents/:id/checkout')
  async checkout(@Req() request: WalletRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(body)
    if (!parsed.success || !z.uuid().safeParse(id).success) throw new BadRequestException('Invalid checkout intent')
    await this.limits.consume('onramper-redeem-global', 'all', 1000)
    await this.limits.consume(
      'onramper-redeem-ip',
      clientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'] as string | undefined),
      30,
    )
    const intent = await this.db.onramperIntent.findUnique({ where: { id } })
    if (
      !intent ||
      intent.sessionId !== request.onramperSession.id ||
      intent.expiresAt <= new Date() ||
      intent.tokenHash !== createHash('sha256').update(parsed.data.token).digest('hex') ||
      intent.origin !== request.headers.origin ||
      !checkoutOrigins().includes(intent.origin)
    )
      throw new UnauthorizedException('Invalid or expired checkout intent')
    const checkout = checkoutSchema.parse(intent.checkout)
    if (checkout.address !== request.onramperSession.address) throw new UnauthorizedException('Wallet mismatch')
    const apiKey = process.env.ONRAMPER_API_KEY
    const privateKey = process.env.ONRAMPER_V2_PRIVATE_KEY
    if (!apiKey || !privateKey) throw new ServiceUnavailableException('Onramper signing is not configured')
    const url = signWidgetUrl(checkout, {
      apiKey,
      privateKey,
      widgetUrl: process.env.ONRAMPER_WIDGET_URL ?? 'https://buy.onramper.com',
      redirectOrigins: process.env.ONRAMPER_REDIRECT_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [],
    })
    const consumed = await this.db.onramperIntent.deleteMany({
      where: {
        id,
        sessionId: request.onramperSession.id,
        expiresAt: { gt: new Date() },
        session: { expiresAt: { gt: new Date() } },
      },
    })
    if (consumed.count !== 1) throw new UnauthorizedException('Checkout intent already used')
    return { url }
  }
}
