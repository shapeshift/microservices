import { Logger } from '@nestjs/common'
import type BigNumberJs from 'bignumber.js'

Logger.overrideLogger(false)

jest.mock('./env', () => ({
  env: {
    VITE_NEAR_INTENTS_API_KEY: 'x',
    VITE_RELAY_API_KEY: 'x',
    VITE_THORCHAIN_MIDGARD_URL: 'https://thorchain-midgard.test',
    VITE_MAYACHAIN_MIDGARD_URL: 'https://mayachain-midgard.test',
    VITE_RELAY_API_URL: 'https://relay.test',
  },
}))

jest.mock('./utils/pricing', () => ({
  getAssetPriceUsd: jest.fn(),
  getAssetPriceUsdAt: jest.fn(),
}))

// chain-adapters transitively imports p-queue (ESM-only) which Jest's CJS loader can't parse.
// We only need bnOrZero in tests, so stub it via bignumber.js directly.
jest.mock('@shapeshiftoss/chain-adapters', () => {
  const BigNumber = jest.requireActual<typeof BigNumberJs>('bignumber.js')
  return {
    bnOrZero: (x: unknown) => {
      const bn = new BigNumber(x as BigNumberJs.Value)
      return bn.isFinite() ? bn : new BigNumber(0)
    },
  }
})

jest.mock('@shapeshiftoss/swapper', () => ({
  SwapperName: {
    Thorchain: 'THORChain',
    Mayachain: 'MAYAChain',
    CowSwap: 'CoW Swap',
    Zrx: '0x',
    Test: 'Test',
    ArbitrumBridge: 'Arbitrum Bridge',
    Portals: 'Portals',
    Chainflip: 'Chainflip',
    Relay: 'Relay',
    ButterSwap: 'ButterSwap',
    Bebop: 'Bebop',
    NearIntents: 'NEAR Intents',
    Cetus: 'Cetus',
    Sunio: 'Sun.io',
    Avnu: 'AVNU',
    Stonfi: 'STON.fi',
    Across: 'Across',
    Debridge: 'deBridge',
    BobGateway: 'BOB Gateway',
    Fynd: 'Fynd',
    KyberSwap: 'KyberSwap',
    Symbiosis: 'Symbiosis',
  },
  THORCHAIN_AFFILIATE_NAME: 'ss',
  MAYACHAIN_AFFILIATE_NAME: 'ssmaya',
  swappers: {},
  getSwapMetadata: (metadata: { name?: string } | undefined, name: string) => {
    if (metadata?.name !== name) throw new Error(`Expected ${name} swap metadata`)
    return metadata
  },
  // mirrors the swapper's mapping for EVM chains and Solana, Relay chain id 792703809
  relayTokenToAssetId: (token: { chainId: number; address: string }) => {
    if (token.chainId === 792703809) {
      const solana = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      return token.address === '11111111111111111111111111111111'
        ? `${solana}/slip44:501`
        : `${solana}/token:${token.address}`
    }
    const isNative = token.address.toLowerCase() === '0x0000000000000000000000000000000000000000'
    return isNative
      ? `eip155:${token.chainId}/slip44:60`
      : `eip155:${token.chainId}/erc20:${token.address.toLowerCase()}`
  },
}))
