import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'

import type { ChainId } from '@shapeshiftoss/caip'
import * as caip from '@shapeshiftoss/caip'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../env'

export type TxLookup =
  | { outcome: 'found'; timestamp: number }
  | { outcome: 'not-found' }
  | { outcome: 'unsupported' }
  | { outcome: 'error'; reason: string }

type Fetcher = (txid: string) => Promise<TxLookup>

const rpc = async <T>(url: string, method: string, params: unknown[]): Promise<T> => {
  const { data } = await axios.post(url, { jsonrpc: '2.0', id: 1, method, params }, { timeout: 10_000 })
  if (data.error) throw new Error(`${method}: ${data.error.message ?? JSON.stringify(data.error)}`)

  return data.result as T
}

// eth_getTransactionByHash carries the block number but not its time, so the block is a second hop
const evmFetcher =
  (url: string): Fetcher =>
  async (txid) => {
    const tx = await rpc<{ blockNumber: string | null } | null>(url, 'eth_getTransactionByHash', [txid])

    // absent, or seen but still unmined - neither tells us when it was broadcast
    if (!tx?.blockNumber) return { outcome: 'not-found' }

    const block = await rpc<{ timestamp: string } | null>(url, 'eth_getBlockByNumber', [tx.blockNumber, false])
    if (!block) return { outcome: 'not-found' }

    return { outcome: 'found', timestamp: parseInt(block.timestamp, 16) }
  }

const unchainedFetcher =
  (getTx: (req: { txid: string }) => Promise<{ timestamp: number }>): Fetcher =>
  async (txid) => {
    const { timestamp } = await getTx({ txid })

    return { outcome: 'found', timestamp }
  }

@Injectable()
export class TxLookupService {
  private readonly logger = new Logger(TxLookupService.name)
  private readonly fetchers = new Map<ChainId, Fetcher>()

  constructor() {
    const evmNodes: [ChainId, string][] = [
      [caip.ethChainId, env.VITE_ETHEREUM_NODE_URL],
      [caip.avalancheChainId, env.VITE_AVALANCHE_NODE_URL],
      [caip.optimismChainId, env.VITE_OPTIMISM_NODE_URL],
      [caip.bscChainId, env.VITE_BNBSMARTCHAIN_NODE_URL],
      [caip.polygonChainId, env.VITE_POLYGON_NODE_URL],
      [caip.gnosisChainId, env.VITE_GNOSIS_NODE_URL],
      [caip.arbitrumChainId, env.VITE_ARBITRUM_NODE_URL],
      [caip.baseChainId, env.VITE_BASE_NODE_URL],
      [caip.monadChainId, env.VITE_MONAD_NODE_URL],
      [caip.hyperEvmChainId, env.VITE_HYPEREVM_NODE_URL],
      [caip.plasmaChainId, env.VITE_PLASMA_NODE_URL],
      [caip.katanaChainId, env.VITE_KATANA_NODE_URL],
      [KnownChainIds.MegaEthMainnet, env.VITE_MEGAETH_NODE_URL],
    ]

    for (const [chainId, url] of evmNodes) this.fetchers.set(chainId, evmFetcher(url))

    // no rpc node urls exist for these, so unchained is the only route
    const utxoNodes: [ChainId, string][] = [
      [caip.btcChainId, env.VITE_UNCHAINED_BITCOIN_HTTP_URL],
      [caip.bchChainId, env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL],
      [caip.dogeChainId, env.VITE_UNCHAINED_DOGECOIN_HTTP_URL],
      [caip.ltcChainId, env.VITE_UNCHAINED_LITECOIN_HTTP_URL],
    ]

    for (const [chainId, basePath] of utxoNodes) {
      const api = new unchained.bitcoin.V1Api(new unchained.bitcoin.Configuration({ basePath }))
      this.fetchers.set(chainId, unchainedFetcher((req) => api.getTransaction(req)))
    }

    const thorchain = new unchained.thorchain.V1Api(
      new unchained.thorchain.Configuration({ basePath: env.VITE_UNCHAINED_THORCHAIN_HTTP_URL }),
    )
    this.fetchers.set(caip.thorchainChainId, unchainedFetcher((req) => thorchain.getTx(req)))

    const mayachain = new unchained.mayachain.V1Api(
      new unchained.mayachain.Configuration({ basePath: env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL }),
    )
    this.fetchers.set(caip.mayachainChainId, unchainedFetcher((req) => mayachain.getTx(req)))

    const cosmos = new unchained.cosmos.V1Api(
      new unchained.cosmos.Configuration({ basePath: env.VITE_UNCHAINED_COSMOS_HTTP_URL }),
    )
    this.fetchers.set(caip.cosmosChainId, unchainedFetcher((req) => cosmos.getTx(req)))

    const solana = new unchained.solana.V1Api(
      new unchained.solana.Configuration({ basePath: env.VITE_UNCHAINED_SOLANA_HTTP_URL }),
    )
    this.fetchers.set(caip.solanaChainId, unchainedFetcher((req) => solana.getTransaction(req)))
  }

  supports(chainId: ChainId): boolean {
    return this.fetchers.has(chainId)
  }

  async getTimestamp(chainId: ChainId, txid: string): Promise<TxLookup> {
    const fetcher = this.fetchers.get(chainId)
    if (!fetcher) return { outcome: 'unsupported' }

    try {
      return await fetcher(txid)
    } catch (error) {
      // a 404 means the chain answered and does not have it, which is not the same as being unable to ask
      if (error instanceof unchained.ResponseError && error.response.status === 404) {
        return { outcome: 'not-found' }
      }

      const reason = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Tx lookup failed for ${txid} on ${chainId}: ${reason}`)

      return { outcome: 'error', reason }
    }
  }
}
