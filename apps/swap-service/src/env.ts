import { config } from 'dotenv'
import { z } from 'zod'

config()

const schema = z.object({
  // Runtime
  ALLOWED_ORIGINS: z.string().min(1).optional(),
  PORT: z.string().min(1).optional(),

  // Security
  ACCOUNT_ID_SALT: z.string().min(1),
  SIWE_JWT_SECRET: z.string().min(1),
  SERVICE_API_KEY: z.string().min(1),

  // API Keys
  VITE_BEBOP_API_KEY: z.string().min(1),
  VITE_NEAR_INTENTS_API_KEY: z.string().min(1),
  VITE_CHAINFLIP_API_KEY: z.string().min(1),
  VITE_RELAY_API_KEY: z.string().min(1),
  VITE_ACROSS_API_KEY: z.string().min(1),

  // Database
  DATABASE_URL: z.string().min(1),

  // Unchained API URLs
  VITE_UNCHAINED_ETHEREUM_HTTP_URL: z.url(),
  VITE_UNCHAINED_ETHEREUM_WS_URL: z.url(),
  VITE_UNCHAINED_AVALANCHE_HTTP_URL: z.url(),
  VITE_UNCHAINED_AVALANCHE_WS_URL: z.url(),
  VITE_UNCHAINED_OPTIMISM_HTTP_URL: z.url(),
  VITE_UNCHAINED_OPTIMISM_WS_URL: z.url(),
  VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL: z.url(),
  VITE_UNCHAINED_BNBSMARTCHAIN_WS_URL: z.url(),
  VITE_UNCHAINED_POLYGON_HTTP_URL: z.url(),
  VITE_UNCHAINED_POLYGON_WS_URL: z.url(),
  VITE_UNCHAINED_GNOSIS_HTTP_URL: z.url(),
  VITE_UNCHAINED_GNOSIS_WS_URL: z.url(),
  VITE_UNCHAINED_ARBITRUM_HTTP_URL: z.url(),
  VITE_UNCHAINED_ARBITRUM_WS_URL: z.url(),
  VITE_UNCHAINED_BASE_HTTP_URL: z.url(),
  VITE_UNCHAINED_BASE_WS_URL: z.url(),
  VITE_UNCHAINED_BITCOIN_HTTP_URL: z.url(),
  VITE_UNCHAINED_BITCOIN_WS_URL: z.url(),
  VITE_UNCHAINED_DOGECOIN_HTTP_URL: z.url(),
  VITE_UNCHAINED_DOGECOIN_WS_URL: z.url(),
  VITE_UNCHAINED_LITECOIN_HTTP_URL: z.url(),
  VITE_UNCHAINED_LITECOIN_WS_URL: z.url(),
  VITE_UNCHAINED_BITCOINCASH_HTTP_URL: z.url(),
  VITE_UNCHAINED_BITCOINCASH_WS_URL: z.url(),
  VITE_UNCHAINED_COSMOS_HTTP_URL: z.url(),
  VITE_UNCHAINED_COSMOS_WS_URL: z.url(),
  VITE_UNCHAINED_THORCHAIN_HTTP_URL: z.url(),
  VITE_UNCHAINED_THORCHAIN_WS_URL: z.url(),
  VITE_UNCHAINED_THORCHAIN_V1_HTTP_URL: z.url(),
  VITE_UNCHAINED_MAYACHAIN_HTTP_URL: z.url(),
  VITE_UNCHAINED_MAYACHAIN_WS_URL: z.url(),
  VITE_UNCHAINED_SOLANA_HTTP_URL: z.url(),
  VITE_UNCHAINED_SOLANA_WS_URL: z.url(),
  VITE_UNCHAINED_ZCASH_HTTP_URL: z.url(),
  VITE_UNCHAINED_ZCASH_WS_URL: z.url(),

  // Node URLs
  VITE_ETHEREUM_NODE_URL: z.url(),
  VITE_AVALANCHE_NODE_URL: z.url(),
  VITE_OPTIMISM_NODE_URL: z.url(),
  VITE_BNBSMARTCHAIN_NODE_URL: z.url(),
  VITE_POLYGON_NODE_URL: z.url(),
  VITE_GNOSIS_NODE_URL: z.url(),
  VITE_ARBITRUM_NODE_URL: z.url(),
  VITE_BASE_NODE_URL: z.url(),
  VITE_THORCHAIN_NODE_URL: z.url(),
  VITE_MAYACHAIN_NODE_URL: z.url(),
  VITE_SOLANA_NODE_URL: z.url(),

  // Midgard URLs
  VITE_THORCHAIN_MIDGARD_URL: z.url(),
  VITE_MAYACHAIN_MIDGARD_URL: z.url(),

  // Service URLs
  NOTIFICATIONS_SERVICE_URL: z.url(),
  USER_SERVICE_URL: z.url(),
})

const result = schema.safeParse(process.env)
if (!result.success) throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`)

export const env = Object.freeze({
  ...result.data,
  VITE_UNCHAINED_MONAD_HTTP_URL: 'https://rpc.monad.xyz',
  VITE_UNCHAINED_MONAD_WS_URL: 'wss://rpc3.monad.xyz',
  VITE_BOB_NODE_URL: 'https://rpc.gobob.xyz',
  VITE_CELO_NODE_URL: 'https://forno.celo.org',
  VITE_CRONOS_NODE_URL: 'https://evm.cronos.org',
  VITE_ELYSIUM_NODE_URL: 'https://rpc.elysium.kinetiq.xyz',
  VITE_HYPEREVM_NODE_URL: 'https://rpc.hyperliquid.xyz/evm',
  VITE_INK_NODE_URL: 'https://rpc-gel.inkonchain.com',
  VITE_KATANA_NODE_URL: 'https://rpc.katana.network',
  VITE_MANTLE_NODE_URL: 'https://rpc.mantle.xyz',
  VITE_MEGAETH_NODE_URL: 'https://mainnet.megaeth.com/rpc',
  VITE_MONAD_NODE_URL: 'https://rpc.monad.xyz',
  VITE_NEAR_NODE_URLS: 'https://rpc.mainnet.near.org,https://near.lava.build,https://rpc.fastnear.com',
  // verification reads swap transactions long after regular nodes have garbage collected them
  VITE_NEAR_ARCHIVAL_NODE_URL: 'https://archival-rpc.mainnet.fastnear.com',
  VITE_PLASMA_NODE_URL: 'https://rpc.plasma.to',
  VITE_ROBINHOOD_NODE_URL: 'https://rpc.mainnet.chain.robinhood.com',
  VITE_SEI_NODE_URL: 'https://evm-rpc.sei-apis.com',
  VITE_SONIC_NODE_URL: 'https://rpc.soniclabs.com',
  VITE_STARKNET_NODE_URL: 'https://rpc.starknet.lava.build',
  VITE_SUI_NODE_URL: 'https://fullnode.mainnet.sui.io',
  VITE_TON_NODE_URL: 'https://toncenter.com/api/v2/jsonRPC',
  VITE_TRON_NODE_URL: 'https://api.trongrid.io',
  VITE_UNICHAIN_NODE_URL: 'https://mainnet.unichain.org',
  VITE_APTOS_INDEXER_URL: 'https://api.mainnet.aptoslabs.com',
  VITE_APTOS_NODE_URL: 'https://fullnode.mainnet.aptoslabs.com',
  VITE_ACROSS_API_URL: 'https://app.across.to/api',
  VITE_CHAINFLIP_API_URL: 'https://chainflip-broker.io',
  VITE_COWSWAP_BASE_URL: 'https://api.cow.fi',
  VITE_DEBRIDGE_API_URL: '',
  VITE_FYND_BASE_URL: 'https://api.proxy.shapeshift.com/api/v1/fynd',
  VITE_KYBER_BASE_URL: 'https://api.proxy.shapeshift.com/api/v1/kyber',
  VITE_NEAR_FAST_API_URL: 'https://api.fastnear.com',
  VITE_PORTALS_BASE_URL: 'https://api.proxy.shapeshift.com/api/v1/portals',
  VITE_RELAY_API_URL: 'https://api.relay.link',
  VITE_SYMBIOSIS_API_URL: 'https://api.proxy.shapeshift.com/api/v1/symbiosis',
  VITE_ZRX_BASE_URL: 'https://api.proxy.shapeshift.com/api/v1/zrx',
})

export type Env = typeof env
