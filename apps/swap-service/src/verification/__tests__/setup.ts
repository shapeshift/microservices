import { Logger } from '@nestjs/common'

Logger.overrideLogger(false)

jest.mock('../../env', () => ({
  env: {
    VITE_BEBOP_API_KEY: 'x',
    VITE_CHAINFLIP_API_KEY: 'x',
    VITE_NEAR_INTENTS_API_KEY: 'x',
    VITE_THORCHAIN_NODE_URL: 'https://thornode.test',
    VITE_MAYACHAIN_NODE_URL: 'https://mayanode.test',
    VITE_ACROSS_API_URL: 'https://across.test',
    VITE_BEBOP_API_URL: 'https://bebop.test',
    VITE_CHAINFLIP_API_URL: 'https://chainflip.test',
    VITE_COWSWAP_BASE_URL: 'https://cow.test',
    VITE_PORTALS_BASE_URL: 'https://portals.test',
    VITE_RELAY_API_URL: 'https://relay.test',
    VITE_ZRX_BASE_URL: 'https://zrx.test',
  },
}))

// @shapeshiftoss/swapper transitively pulls chain-adapters → p-queue (ESM) → bigint-buffer.
// We don't exercise swapper internals here, so stub the module surface the verifier touches.
// Keep enum string values identical to the real module so production code paths match.
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
