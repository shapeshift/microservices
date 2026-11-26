import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import * as jwt from 'jsonwebtoken'

import { env } from '../env'

import { SIWE_TOKEN_AUDIENCE, SIWE_TOKEN_ISSUER } from './siwe-policy'

interface SiweJwtPayload {
  address: string
  iat: number
  exp: number
}

export interface SiweRequest extends Request {
  siweAddress: string
}

@Injectable()
export class SiweAuthGuard implements CanActivate {
  private readonly jwtSecret = env.SIWE_JWT_SECRET

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SiweRequest>()
    const authHeader = request.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing SIWE authentication token')
    }

    const token = authHeader.slice(7)

    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        issuer: SIWE_TOKEN_ISSUER,
        audience: SIWE_TOKEN_AUDIENCE,
      }) as SiweJwtPayload
      request.siweAddress = payload.address.toLowerCase()
      return true
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token')
    }
  }
}
