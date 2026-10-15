import { ServiceUnavailableException } from '@nestjs/common'

export const evmNetworks: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  100: 'gnosis',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avaxc',
}

export function checkoutOrigins(): string[] {
  const values = process.env.ONRAMPER_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()) ?? []
  if (!values.length || values.some((value) => !isAllowedUrl(value, true)))
    throw new ServiceUnavailableException('Invalid checkout origin configuration')
  return values
}

export function isAllowedUrl(value: string, originOnly = false): boolean {
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      (!originOnly || url.origin === value) &&
      (url.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)))
    )
  } catch {
    return false
  }
}
