import type { SiweMessage } from 'siwe'

export const SIWE_TOKEN_ISSUER = 'shapeshift:siwe:v2'
export const SIWE_TOKEN_AUDIENCE = 'shapeshift:affiliate'

export const NONCE_EXPIRY_MS = 5 * 60 * 1000

export function assertSiwePolicy(message: SiweMessage, allowedOrigins: string[], now: number): void {
  const uri = new URL(message.uri)
  const issuedAt = Date.parse(message.issuedAt)
  const expiresAt = message.expirationTime ? Date.parse(message.expirationTime) : issuedAt + NONCE_EXPIRY_MS
  const notBefore = message.notBefore ? Date.parse(message.notBefore) : issuedAt
  if (
    !allowedOrigins.includes(uri.origin) ||
    message.uri !== uri.origin ||
    message.domain !== uri.host ||
    (message.scheme !== undefined && message.scheme !== uri.protocol.slice(0, -1)) ||
    uri.username ||
    uri.password ||
    message.version !== '1' ||
    message.chainId !== 42161 ||
    message.statement !== 'Sign in to ShapeShift Affiliate Dashboard' ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now ||
    now - issuedAt > NONCE_EXPIRY_MS ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt > issuedAt + NONCE_EXPIRY_MS ||
    !Number.isFinite(notBefore) ||
    notBefore > now ||
    (message.resources?.length ?? 0) > 0 ||
    message.requestId !== undefined
  )
    throw new Error('SIWE policy mismatch')
}
