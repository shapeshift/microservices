import { BadRequestException, ForbiddenException } from '@nestjs/common'

import type { SiweRequest } from './siwe-auth.guard'

export const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
export const PARTNER_CODE_REGEX = /^[a-zA-Z0-9-]{3,32}$/
export const RESERVED_PARTNER_CODES = ['ss', 'admin', 'api', 'test', 'demo']

export function assertAddressQuery(address: string | undefined): asserts address is string {
  if (!address) throw new BadRequestException('address query parameter is required')
}

export function assertEvmAddress(address: string | undefined, label: string): void {
  if (!address || !EVM_ADDRESS_REGEX.test(address)) throw new BadRequestException(`Invalid ${label}`)
}

export function assertOptionalEvmAddress(address: string | undefined, label: string): void {
  if (address && !EVM_ADDRESS_REGEX.test(address)) throw new BadRequestException(`Invalid ${label}`)
}

export function assertBpsInRange(bps: number | undefined): void {
  if (bps !== undefined && (bps < 0 || bps > 1000)) throw new BadRequestException('BPS must be between 0 and 1000')
}

export function assertPartnerCode(partnerCode: string): void {
  if (!PARTNER_CODE_REGEX.test(partnerCode)) {
    throw new BadRequestException('Partner code must be 3-32 alphanumeric characters or hyphens')
  }
}

export function assertSiweMatches(req: SiweRequest, target: string, message: string): void {
  if (req.siweAddress !== target.toLowerCase()) throw new ForbiddenException(message)
}

export function parseDateRange(startDate?: string, endDate?: string): { start?: Date; end?: Date } {
  return {
    start: startDate ? new Date(startDate) : undefined,
    end: endDate ? new Date(endDate) : undefined,
  }
}

export function calculateAffiliateFeeUsd(sellAmountUsd: string | null, affiliateBps: string | null): string | null {
  if (!sellAmountUsd || !affiliateBps) return null
  return ((parseFloat(sellAmountUsd) * parseInt(affiliateBps, 10)) / 10000).toFixed(2)
}
