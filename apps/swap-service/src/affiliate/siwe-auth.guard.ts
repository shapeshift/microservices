import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import * as jwt from 'jsonwebtoken'

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
  private readonly jwtSecret: string

  constructor() {
    const secret = process.env.SIWE_JWT_SECRET
    if (!secret) throw new Error('SIWE_JWT_SECRET is required')
    this.jwtSecret = secret
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SiweRequest>()
    const authHeader = request.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing SIWE authentication token')
    }

    const token = authHeader.slice(7)

    try {
      const payload = jwt.verify(token, this.jwtSecret) as SiweJwtPayload
      request.siweAddress = payload.address.toLowerCase()
      return true
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token')
    }
  }
}
