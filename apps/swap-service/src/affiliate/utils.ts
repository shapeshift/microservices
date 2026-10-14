import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { getAddress } from 'viem'

import type { SiweRequest } from './siwe-auth.guard'

export const PARTNER_CODE_REGEX = /^[a-z0-9]{3,32}$/

const RESERVED_PARTNER_CODES = [
  'admin',
  'api',
  'auth',
  'demo',
  'dev',
  'develop',
  'prod',
  'production',
  'release',
  'ss',
  'system',
  'test',
]

const RESERVED_PARTNER_CODE_SUBSTRINGS = ['shapeshift']

export function isReservedPartnerCode(partnerCode: string): boolean {
  const code = partnerCode.toLowerCase()
  if (RESERVED_PARTNER_CODES.includes(code)) return true
  return RESERVED_PARTNER_CODE_SUBSTRINGS.some((substring) => code.includes(substring))
}

export function assertSiweMatches(req: SiweRequest, target: string, message: string): void {
  if (req.siweAddress !== target.toLowerCase()) throw new ForbiddenException(message)
}

// Every address is stored in EIP-55 checksum form regardless of how the caller sent it
export const toChecksumAddress = (address: string): string => {
  try {
    return getAddress(address)
  } catch {
    throw new BadRequestException(`Invalid address: ${address}`)
  }
}
