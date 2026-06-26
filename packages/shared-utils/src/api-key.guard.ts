import * as crypto from 'crypto'

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'

export const API_KEY_HEADER = 'x-api-key'

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
 * Note: routes registered directly on the underlying HTTP adapter (e.g. `/health`)
 * are not Nest routes and are therefore not covered by this guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedKey: string

  constructor() {
    const key = process.env.SERVICE_API_KEY
    if (!key) {
      throw new Error('Required environment variable SERVICE_API_KEY is not set')
    }
    this.expectedKey = key
  }

  canActivate(context: ExecutionContext): boolean {
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
