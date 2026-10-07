import { createHash, timingSafeEqual } from 'node:crypto'
import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { PrismaClient } from '@prisma/client'

export const DeviceAccess = () => SetMetadata('device-access', true)
export const PublicAccess = () => SetMetadata('public-access', true)
export type UserRequest = { headers: Record<string, string | string[] | undefined>; userId: string }
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export function allowedOrigins(): string[] {
  const values = process.env.DEVICE_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()) ?? []
  if (
    !values.length ||
    values.some((value) => {
      try {
        const url = new URL(value)
        return (
          url.origin !== value ||
          (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
        )
      } catch {
        return true
      }
    })
  )
    throw new Error('DEVICE_ALLOWED_ORIGINS must contain exact application origins')
  return values
}

@Injectable()
export class DeviceSessions {
  constructor(@Inject('SECURITY_DB') private readonly db: PrismaClient) {}

  async authenticate(token: unknown): Promise<{ userId: string; expiresAt: Date }> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('Sign in required')
    const session = await this.db.deviceSession.findUnique({ where: { tokenHash: hashToken(token) } })
    if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException('Session expired')
    return { userId: session.userId, expiresAt: session.expiresAt }
  }

  async fromRequest(request: UserRequest): Promise<{ userId: string; expiresAt: Date }> {
    const header = request.headers.authorization
    return this.authenticate(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined)
  }
}

@Injectable()
export class ServiceOrDeviceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: DeviceSessions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>('public-access', targets)) return true
    const request = context.switchToHttp().getRequest<UserRequest>()
    if (this.reflector.getAllAndOverride<boolean>('device-access', targets)) {
      request.userId = (await this.sessions.fromRequest(request)).userId
      return true
    }
    const expected = process.env.SERVICE_API_KEY
    const supplied = request.headers['x-api-key']
    if (
      !expected ||
      typeof supplied !== 'string' ||
      !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest())
    )
      throw new UnauthorizedException('Service credential required')
    return true
  }
}
