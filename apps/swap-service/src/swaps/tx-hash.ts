import { CHAIN_NAMESPACE, fromChainId } from '@shapeshiftoss/caip'

const HEX_HASH = /^(0x)?[0-9a-f]+$/i
const HEX_32 = /^(0x)?[0-9a-f]{64}$/i
const BASE64_32 = /^[A-Za-z0-9+/_-]{43}=?$/

// 2^251 + 17 * 2^192 + 1, every Starknet field element is below it
const STARKNET_FIELD_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n

const chainNamespaceOf = (chainId: string): string | undefined => {
  try {
    return fromChainId(chainId).chainNamespace
  } catch {
    return
  }
}

// a field element, which explorers and nodes print without leading zeros
const canonicalStarknetHash = (hash: string): string | undefined => {
  if (!/^0x[0-9a-f]{1,64}$/i.test(hash)) return
  const value = BigInt(hash)
  return value < STARKNET_FIELD_PRIME ? `0x${value.toString(16)}` : undefined
}

// TON tooling reports the same 32 byte hash in hex, base64 or base64url; the adapter takes hex
const canonicalTonHash = (hash: string): string | undefined => {
  if (HEX_32.test(hash)) return hash.replace(/^0x/i, '').toLowerCase()
  if (!BASE64_32.test(hash)) return
  const bytes = Buffer.from(hash.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return bytes.length === 32 ? bytes.toString('hex') : undefined
}

// One spelling per transaction, so a hash written in another case, with or without 0x, or in another encoding is
// still the same claim. Hashes take the form each chain's own tooling reports; one that fits no known form for its
// chain is kept as given (base58 and other case sensitive encodings) or, if hex, in the usual 0x spelling.
export const canonicalizeTxHash = (chainId: string, hash: string): string => {
  const trimmed = hash.trim()
  const namespace = chainNamespaceOf(chainId)

  if (namespace === CHAIN_NAMESPACE.Ton) {
    const ton = canonicalTonHash(trimmed)
    if (ton) return ton
  }

  if (namespace === CHAIN_NAMESPACE.Starknet) {
    const starknet = canonicalStarknetHash(trimmed)
    if (starknet) return starknet
  }

  if (!HEX_HASH.test(trimmed)) return trimmed

  const digits = trimmed.replace(/^0x/i, '')

  switch (namespace) {
    case CHAIN_NAMESPACE.Evm:
      return `0x${digits.toLowerCase()}`
    case CHAIN_NAMESPACE.Utxo:
    case CHAIN_NAMESPACE.Tron:
      return digits.toLowerCase()
    case CHAIN_NAMESPACE.CosmosSdk:
      return digits.toUpperCase()
    default:
      return trimmed.toLowerCase().startsWith('0x') ? `0x${digits.toLowerCase()}` : trimmed
  }
}

export const canonicalizeOptionalTxHash = (chainId: string, hash: string | null | undefined): string | undefined =>
  hash ? canonicalizeTxHash(chainId, hash) : undefined

// The key an accepted claim holds, unique across swaps, so only one swap is ever attributed a transaction
export const acceptedSellTxKey = (chainId: string, hash: string): string =>
  `${chainId}:${canonicalizeTxHash(chainId, hash)}`
