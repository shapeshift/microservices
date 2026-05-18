import { Logger } from '@nestjs/common'
import type BigNumberJs from 'bignumber.js'

Logger.overrideLogger(false)

jest.mock('../../env', () => ({
  env: {
    VITE_BEBOP_API_KEY: 'x',
    VITE_CHAINFLIP_API_KEY: 'x',
    VITE_NEAR_INTENTS_API_KEY: 'x',
    VITE_THORCHAIN_NODE_URL: 'https://thornode.test',
    VITE_THORCHAIN_MIDGARD_URL: 'https://thorchain-midgard.test',
    VITE_MAYACHAIN_MIDGARD_URL: 'https://mayachain-midgard.test',
    VITE_ACROSS_API_URL: 'https://across.test',
    VITE_BEBOP_API_URL: 'https://bebop.test',
    VITE_CHAINFLIP_API_URL: 'https://chainflip.test',
    VITE_COWSWAP_BASE_URL: 'https://cow.test',
    VITE_PORTALS_BASE_URL: 'https://portals.test',
    VITE_RELAY_API_URL: 'https://relay.test',
    VITE_ZRX_BASE_URL: 'https://zrx.test',
  },
}))

jest.mock('../../utils/pricing', () => ({
  getAssetPriceUsd: jest.fn(),
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
  },
  assertGetCowNetwork: jest.fn(),
  getTreasuryAddressFromChainId: jest.fn(),
}))
