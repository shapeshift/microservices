import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SIWE_JWT_SECRET || 'affiliate-siwe-secret-dev';

interface SiweJwtPayload {
  address: string;
  iat: number;
  exp: number;
}

export interface SiweRequest extends Request {
  siweAddress: string;
}

@Injectable()
export class SiweAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SiweRequest>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing SIWE authentication token');
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(token, JWT_SECRET) as SiweJwtPayload;
      request.siweAddress = payload.address.toLowerCase();
      return true;
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }
  }
}
