import type { ChainId } from '@shapeshiftoss/caip'
import type { SwapperConfig } from '@shapeshiftoss/swapper'

import { env } from '../env'
import type { CosmosSdkChainAdapterService } from '../lib/chain-adapters/cosmos-sdk.service'
import type { EvmChainAdapterService } from '../lib/chain-adapters/evm.service'
import type { NearChainAdapterService } from '../lib/chain-adapters/near.service'
import type { SolanaChainAdapterService } from '../lib/chain-adapters/solana.service'
import type { StarknetChainAdapterService } from '../lib/chain-adapters/starknet.service'
import type { SuiChainAdapterService } from '../lib/chain-adapters/sui.service'
import type { TonChainAdapterService } from '../lib/chain-adapters/ton.service'
import type { TronChainAdapterService } from '../lib/chain-adapters/tron.service'
import type { UtxoChainAdapterService } from '../lib/chain-adapters/utxo.service'

export const getSwapperConfig = (): SwapperConfig => ({
  VITE_ACROSS_API_URL: env.VITE_ACROSS_API_URL,
  VITE_ACROSS_INTEGRATOR_ID: '',
  VITE_BEBOP_API_KEY: env.VITE_BEBOP_API_KEY,
  VITE_BOB_GATEWAY_API_KEY: '',
  VITE_CHAINFLIP_API_KEY: env.VITE_CHAINFLIP_API_KEY,
  VITE_CHAINFLIP_API_URL: env.VITE_CHAINFLIP_API_URL,
  VITE_COWSWAP_BASE_URL: env.VITE_COWSWAP_BASE_URL,
  VITE_DEBRIDGE_API_URL: env.VITE_DEBRIDGE_API_URL,
  VITE_FEATURE_CHAINFLIP_SWAP_DCA: true,
  VITE_FEATURE_THORCHAINSWAP_L1_TO_LONGTAIL: true,
  VITE_FEATURE_THORCHAINSWAP_LONGTAIL: true,
  VITE_MAYACHAIN_MIDGARD_URL: env.VITE_MAYACHAIN_MIDGARD_URL,
  VITE_MAYACHAIN_NODE_URL: env.VITE_MAYACHAIN_NODE_URL,
  VITE_NEAR_INTENTS_API_KEY: env.VITE_NEAR_INTENTS_API_KEY,
  VITE_PORTALS_BASE_URL: env.VITE_PORTALS_BASE_URL,
  VITE_RELAY_API_URL: env.VITE_RELAY_API_URL,
  VITE_SUI_NODE_URL: env.VITE_SUI_NODE_URL,
  VITE_TENDERLY_ACCOUNT_SLUG: '',
  VITE_TENDERLY_API_KEY: '',
  VITE_TENDERLY_PROJECT_SLUG: '',
  VITE_THORCHAIN_MIDGARD_URL: env.VITE_THORCHAIN_MIDGARD_URL,
  VITE_THORCHAIN_NODE_URL: env.VITE_THORCHAIN_NODE_URL,
  VITE_TRON_GRID_API_KEY: '',
  VITE_TRON_NODE_URL: env.VITE_TRON_NODE_URL,
  VITE_UNCHAINED_AVALANCHE_HTTP_URL: env.VITE_UNCHAINED_AVALANCHE_HTTP_URL,
  VITE_UNCHAINED_BASE_HTTP_URL: env.VITE_UNCHAINED_BASE_HTTP_URL,
  VITE_UNCHAINED_BITCOINCASH_HTTP_URL: env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL,
  VITE_UNCHAINED_BITCOIN_HTTP_URL: env.VITE_UNCHAINED_BITCOIN_HTTP_URL,
  VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL: env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL,
  VITE_UNCHAINED_COSMOS_HTTP_URL: env.VITE_UNCHAINED_COSMOS_HTTP_URL,
  VITE_UNCHAINED_DOGECOIN_HTTP_URL: env.VITE_UNCHAINED_DOGECOIN_HTTP_URL,
  VITE_UNCHAINED_ETHEREUM_HTTP_URL: env.VITE_UNCHAINED_ETHEREUM_HTTP_URL,
  VITE_UNCHAINED_LITECOIN_HTTP_URL: env.VITE_UNCHAINED_LITECOIN_HTTP_URL,
  VITE_UNCHAINED_MAYACHAIN_HTTP_URL: env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL,
  VITE_UNCHAINED_THORCHAIN_HTTP_URL: env.VITE_UNCHAINED_THORCHAIN_HTTP_URL,
  VITE_ZRX_BASE_URL: env.VITE_ZRX_BASE_URL,
})

type ChainAdapterServices = {
  evmChainAdapterService: EvmChainAdapterService
  utxoChainAdapterService: UtxoChainAdapterService
  cosmosSdkChainAdapterService: CosmosSdkChainAdapterService
  solanaChainAdapterService: SolanaChainAdapterService
  tronChainAdapterService: TronChainAdapterService
  suiChainAdapterService: SuiChainAdapterService
  nearChainAdapterService: NearChainAdapterService
  starknetChainAdapterService: StarknetChainAdapterService
  tonChainAdapterService: TonChainAdapterService
}

export const buildChainAdapterAsserts = (services: ChainAdapterServices) => ({
  assertGetEvmChainAdapter: (chainId: ChainId) => services.evmChainAdapterService.assertGetEvmChainAdapter(chainId),
  assertGetUtxoChainAdapter: (chainId: ChainId) => services.utxoChainAdapterService.assertGetUtxoChainAdapter(chainId),
  assertGetCosmosSdkChainAdapter: (chainId: ChainId) =>
    services.cosmosSdkChainAdapterService.assertGetCosmosSdkChainAdapter(chainId),
  assertGetSolanaChainAdapter: (chainId: ChainId) =>
    services.solanaChainAdapterService.assertGetSolanaChainAdapter(chainId),
  assertGetTronChainAdapter: (chainId: ChainId) => services.tronChainAdapterService.assertGetTronChainAdapter(chainId),
  assertGetSuiChainAdapter: (chainId: ChainId) => services.suiChainAdapterService.assertGetSuiChainAdapter(chainId),
  assertGetNearChainAdapter: (chainId: ChainId) => services.nearChainAdapterService.assertGetNearChainAdapter(chainId),
  assertGetStarknetChainAdapter: (chainId: ChainId) =>
    services.starknetChainAdapterService.assertGetStarknetChainAdapter(chainId),
  assertGetTonChainAdapter: (chainId: ChainId) => services.tonChainAdapterService.assertGetTonChainAdapter(chainId),
})
