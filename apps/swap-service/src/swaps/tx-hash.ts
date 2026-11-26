import { CHAIN_NAMESPACE, fromChainId } from '@shapeshiftoss/caip'

const HEX_HASH = /^(0x)?[0-9a-f]+$/i

const chainNamespaceOf = (chainId: string): string | undefined => {
  try {
    return fromChainId(chainId).chainNamespace
  } catch {
    return
  }
}

// One spelling per transaction, so a hash written in another case or with or without 0x is still the same claim.
// Hex hashes take the form each chain's own tooling reports; any other encoding (base58, base64) is case
// sensitive and kept as given.
export const canonicalizeTxHash = (chainId: string, hash: string): string => {
  const trimmed = hash.trim()
  if (!HEX_HASH.test(trimmed)) return trimmed

  const digits = trimmed.replace(/^0x/i, '')

  switch (chainNamespaceOf(chainId)) {
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
