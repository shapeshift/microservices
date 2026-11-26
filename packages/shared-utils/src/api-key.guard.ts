import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import * as crypto from 'crypto'

export const API_KEY_HEADER = 'x-api-key'

/** Metadata key for routes that serve public clients and enforce their own authorization. */
export const PUBLIC_ACCESS = 'public-access'

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>
}

/**
 * Global guard that requires a shared static service API key on every request.
 *
 * Callers must send the key in the `x-api-key` header. The expected value is read
 * once from the `SERVICE_API_KEY` env var at construction time, so a missing key
 * fails the service at boot rather than silently allowing traffic through.
 *
 * Handlers or controllers marked with `PUBLIC_ACCESS` metadata are skipped; they must authorize callers themselves.
 *
 * Note: routes registered directly on the underlying HTTP adapter (e.g. `/health`)
 * are not Nest routes and are therefore not covered by this guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedKey: string

  constructor(@Optional() private readonly reflector?: Reflector) {
    const key = process.env.SERVICE_API_KEY
    if (!key) throw new Error('Required environment variable SERVICE_API_KEY is not set')
    this.expectedKey = key
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector?.getAllAndOverride<boolean>(PUBLIC_ACCESS, [context.getHandler(), context.getClass()])) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithHeaders>()
    const provided = request.headers[API_KEY_HEADER]

    if (typeof provided !== 'string' || !this.isValid(provided)) {
      throw new UnauthorizedException('Missing or invalid service API key')
    }

    return true
  }

  private isValid(provided: string): boolean {
    const a = Buffer.from(provided)
    const b = Buffer.from(this.expectedKey)
    // timingSafeEqual throws on length mismatch, so guard it first.
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  }
}
