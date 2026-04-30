import { ForbiddenException } from '@nestjs/common'

import type { SiweRequest } from './siwe-auth.guard'

export const PARTNER_CODE_REGEX = /^[a-zA-Z0-9-]{3,32}$/
export const RESERVED_PARTNER_CODES = ['ss', 'admin', 'api', 'test', 'demo']

export function assertSiweMatches(req: SiweRequest, target: string, message: string): void {
  if (req.siweAddress !== target.toLowerCase()) throw new ForbiddenException(message)
}
