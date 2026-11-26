import { acceptedSellTxKey, canonicalizeTxHash } from '../tx-hash'

const ETHEREUM = 'eip155:1'
const BITCOIN = 'bip122:000000000019d6689c085ae165831e93'
const THORCHAIN = 'cosmos:thorchain-1'
const TRON = 'tron:0x2b6653dc'
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const STARKNET = 'starknet:SN_MAIN'

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
    expect(canonicalizeTxHash(STARKNET, '0xABC')).toBe('0xabc')
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
