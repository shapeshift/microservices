import { isIP } from 'node:net'

function normalizeIp(address: string): string {
  if (isIP(address) !== 6) return address
  try {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical)
    if (!mapped) return canonical
    return mapped
      .slice(1)
      .flatMap((group) => {
        const value = parseInt(group, 16)
        return [value >> 8, value & 255]
      })
      .join('.')
  } catch {
    return address
  }
}

export function clientIp(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedProxies: string[] = process.env.TRUSTED_PROXY_IPS?.split(',').map((ip) => ip.trim()) ?? [],
): string {
  if (!socketAddress || !isIP(socketAddress)) return 'unknown'
  const socket = normalizeIp(socketAddress)
  const trusted = new Set(trustedProxies.map(normalizeIp))
  if (!trusted.has(socket) || !forwardedFor) return socket
  const hops = forwardedFor.split(',').map((value) => value.trim())
  if (hops.length > 10 || hops.some((hop) => !isIP(hop))) return socket
  return [...hops.map(normalizeIp), socket].reverse().find((hop) => !trusted.has(hop)) ?? socket
}
