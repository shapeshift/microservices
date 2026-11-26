import { acceptedSellTxKey, canonicalizeTxHash } from '../tx-hash'

const ETHEREUM = 'eip155:1'
const BITCOIN = 'bip122:000000000019d6689c085ae165831e93'
const THORCHAIN = 'cosmos:thorchain-1'
const TRON = 'tron:0x2b6653dc'
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const STARKNET = 'starknet:SN_MAIN'
const TON = 'ton:mainnet'

const HEX = '4a4ce957a047378c3f3ac57ca3cc3ab03e61814a7b415f493704d84a9e42d0eb'

describe('canonicalizeTxHash', () => {
  it.each([`0x${HEX}`, `0x${HEX.toUpperCase()}`, HEX, HEX.toUpperCase(), ` 0X${HEX} `])(
    'spells every variant of an EVM hash the same: %s',
    (hash) => {
      expect(canonicalizeTxHash(ETHEREUM, hash)).toBe(`0x${HEX}`)
    },
  )

  it.each([
    [BITCOIN, HEX],
    [TRON, HEX],
    [THORCHAIN, HEX.toUpperCase()],
  ])('takes the usual form of a %s hash', (chainId, expected) => {
    for (const hash of [HEX, HEX.toUpperCase(), `0x${HEX}`]) {
      expect(canonicalizeTxHash(chainId, hash)).toBe(expected)
    }
  })

  it('lowercases a 0x hex hash on other chains', () => {
    expect(canonicalizeTxHash('aptos:mainnet', '0xABC')).toBe('0xabc')
  })

  it.each([
    `0x${HEX}`,
    HEX.toUpperCase(),
    'SkzpV6BHN4w/OsV8o8w6sD5hgUp7QV9JNwTYSp5C0Os=',
    'SkzpV6BHN4w_OsV8o8w6sD5hgUp7QV9JNwTYSp5C0Os',
  ])('spells every encoding of a TON hash as lowercase hex: %s', (hash) => {
    expect(canonicalizeTxHash(TON, hash)).toBe(HEX)
  })

  it('keeps a TON hash that decodes to no 32 byte digest as given', () => {
    expect(canonicalizeTxHash(TON, 'notahash')).toBe('notahash')
  })

  it.each([
    ['0x00ABC', '0xabc'],
    [`0x00${HEX.slice(2)}`, `0x${HEX.slice(2)}`],
    ['0x0000', '0x0'],
    ['0x0', '0x0'],
  ])('strips leading zeros from a Starknet hash: %s', (hash, expected) => {
    expect(canonicalizeTxHash(STARKNET, hash)).toBe(expected)
  })

  it('does not treat a value past the Starknet field as a field element', () => {
    const prime = '0x0800000000000011000000000000000000000000000000000000000000000001'

    expect(canonicalizeTxHash(STARKNET, prime.toUpperCase().replace(/^0X/, '0x'))).toBe(prime)
    expect(canonicalizeTxHash(STARKNET, '0x0800000000000011000000000000000000000000000000000000000000000000')).toBe(
      '0x800000000000011000000000000000000000000000000000000000000000000',
    )
  })

  it('keeps a case-sensitive encoding as given', () => {
    const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'

    expect(canonicalizeTxHash(SOLANA, signature)).toBe(signature)
    expect(canonicalizeTxHash(ETHEREUM, 'nearhash')).toBe('nearhash')
  })

  it('keeps a hex hash on an unparseable chain as given', () => {
    expect(canonicalizeTxHash('not-a-chain', 'ABCDEF')).toBe('ABCDEF')
  })
})

describe('acceptedSellTxKey', () => {
  it('keys a transaction by chain and canonical hash', () => {
    expect(acceptedSellTxKey(ETHEREUM, HEX.toUpperCase())).toBe(`${ETHEREUM}:0x${HEX}`)
  })

  it('keeps the same hash on two EVM chains apart', () => {
    expect(acceptedSellTxKey(ETHEREUM, HEX)).not.toBe(acceptedSellTxKey('eip155:56', HEX))
  })
})
