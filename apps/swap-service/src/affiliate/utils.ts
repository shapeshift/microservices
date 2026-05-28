import { ForbiddenException } from '@nestjs/common'

import type { SiweRequest } from './siwe-auth.guard'

export const PARTNER_CODE_REGEX = /^[a-z0-9]{3,32}$/
export const RESERVED_PARTNER_CODES = [
  'admin',
  'api',
  'auth',
  'demo',
  'dev',
  'email',
  'fox',
  'graphql',
  'help',
  'internal',
  'login',
  'logout',
  'mail',
  'prod',
  'production',
  'qa',
  'register',
  'root',
  'rpc',
  'shape',
  'shapeshift',
  'shapeshiftdao',
  'signin',
  'signup',
  'ss',
  'staff',
  'staging',
  'support',
  'system',
  'test',
  'webhook',
  'www',
]

export function assertSiweMatches(req: SiweRequest, target: string, message: string): void {
  if (req.siweAddress !== target.toLowerCase()) throw new ForbiddenException(message)
}
