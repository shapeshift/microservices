import type { UtxoChainId } from '@shapeshiftoss/types'
import { KnownChainIds } from '@shapeshiftoss/types'

import { env } from '../env'

export const unchainedApi = <C, A>(
  namespace: { V1Api: new (config: C) => A; Configuration: new (params: { basePath: string }) => C },
  basePath: string,
): A => new namespace.V1Api(new namespace.Configuration({ basePath }))

export const UTXO_URLS: Record<UtxoChainId, string> = {
  [KnownChainIds.BitcoinMainnet]: env.VITE_UNCHAINED_BITCOIN_HTTP_URL,
  [KnownChainIds.BitcoinCashMainnet]: env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL,
  [KnownChainIds.DogecoinMainnet]: env.VITE_UNCHAINED_DOGECOIN_HTTP_URL,
  [KnownChainIds.LitecoinMainnet]: env.VITE_UNCHAINED_LITECOIN_HTTP_URL,
  [KnownChainIds.ZcashMainnet]: env.VITE_UNCHAINED_ZCASH_HTTP_URL,
}
