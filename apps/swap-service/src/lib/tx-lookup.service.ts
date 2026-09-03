import { Injectable, Logger } from '@nestjs/common'
import type { PublicClient } from 'viem'
import { BlockNotFoundError, TransactionNotFoundError } from 'viem'

import type { ChainId } from '@shapeshiftoss/caip'
import { viemClientByChainId } from '@shapeshiftoss/contracts'
import type { CosmosSdkChainId, UtxoChainId } from '@shapeshiftoss/types'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../env'

export type TxLookup = { outcome: 'found'; timestamp: number } | { outcome: 'unsupported' | 'not-found' | 'error' }

type Fetcher = (txid: string) => Promise<TxLookup>

type GetTx = (req: { txid: string }) => Promise<{ timestamp: number }>

// a transaction carries the block it landed in but not that block's time, so the block is a second hop
const evmFetcher =
  (client: PublicClient): Fetcher =>
  async (txid) => {
    try {
      const tx = await client.getTransaction({ hash: txid as `0x${string}` })

      // seen but still unmined, which says nothing about when it was broadcast
      if (tx.blockNumber === null) return { outcome: 'not-found' }

      const block = await client.getBlock({ blockNumber: tx.blockNumber })

      return { outcome: 'found', timestamp: Number(block.timestamp) }
    } catch (error) {
      if (error instanceof TransactionNotFoundError || error instanceof BlockNotFoundError) {
        return { outcome: 'not-found' }
      }

      throw error
    }
  }

const unchainedFetcher =
  (getTx: GetTx): Fetcher =>
  async (txid) => {
    try {
      const { timestamp } = await getTx({ txid })

      return { outcome: 'found', timestamp }
    } catch (error) {
      if (error instanceof unchained.ResponseError && error.response.status === 404) return { outcome: 'not-found' }

      throw error
    }
  }

const api = <C, A>(
  namespace: { V1Api: new (config: C) => A; Configuration: new (params: { basePath: string }) => C },
  basePath: string,
): A => new namespace.V1Api(new namespace.Configuration({ basePath }))

// keyed by the chain-id unions, so a chain added to either family fails to compile until it is served here
const UTXO_URLS: Record<UtxoChainId, string> = {
  [KnownChainIds.BitcoinMainnet]: env.VITE_UNCHAINED_BITCOIN_HTTP_URL,
  [KnownChainIds.BitcoinCashMainnet]: env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL,
  [KnownChainIds.DogecoinMainnet]: env.VITE_UNCHAINED_DOGECOIN_HTTP_URL,
  [KnownChainIds.LitecoinMainnet]: env.VITE_UNCHAINED_LITECOIN_HTTP_URL,
  [KnownChainIds.ZcashMainnet]: env.VITE_UNCHAINED_ZCASH_HTTP_URL,
}

const COSMOS_SDK_URLS: Record<CosmosSdkChainId, string> = {
  [KnownChainIds.CosmosMainnet]: env.VITE_UNCHAINED_COSMOS_HTTP_URL,
  [KnownChainIds.ThorchainMainnet]: env.VITE_UNCHAINED_THORCHAIN_HTTP_URL,
  [KnownChainIds.MayachainMainnet]: env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL,
}

@Injectable()
export class TxLookupService {
  private readonly logger = new Logger(TxLookupService.name)
  private readonly fetchers = new Map<ChainId, Fetcher>()

  constructor() {
    for (const [chainId, client] of Object.entries(viemClientByChainId)) {
      this.fetchers.set(chainId, evmFetcher(client))
    }

    const btc = api(unchained.bitcoin, UTXO_URLS[KnownChainIds.BitcoinMainnet])
    const bch = api(unchained.bitcoincash, UTXO_URLS[KnownChainIds.BitcoinCashMainnet])
    const doge = api(unchained.dogecoin, UTXO_URLS[KnownChainIds.DogecoinMainnet])
    const ltc = api(unchained.litecoin, UTXO_URLS[KnownChainIds.LitecoinMainnet])
    const zec = api(unchained.zcash, UTXO_URLS[KnownChainIds.ZcashMainnet])
    const cosmos = api(unchained.cosmos, COSMOS_SDK_URLS[KnownChainIds.CosmosMainnet])
    const thorchain = api(unchained.thorchain, COSMOS_SDK_URLS[KnownChainIds.ThorchainMainnet])
    const mayachain = api(unchained.mayachain, COSMOS_SDK_URLS[KnownChainIds.MayachainMainnet])
    const solana = api(unchained.solana, env.VITE_UNCHAINED_SOLANA_HTTP_URL)

    const nodes: [ChainId, GetTx][] = [
      [KnownChainIds.BitcoinMainnet, (req) => btc.getTransaction(req)],
      [KnownChainIds.BitcoinCashMainnet, (req) => bch.getTransaction(req)],
      [KnownChainIds.DogecoinMainnet, (req) => doge.getTransaction(req)],
      [KnownChainIds.LitecoinMainnet, (req) => ltc.getTransaction(req)],
      [KnownChainIds.ZcashMainnet, (req) => zec.getTransaction(req)],
      [KnownChainIds.CosmosMainnet, (req) => cosmos.getTx(req)],
      [KnownChainIds.ThorchainMainnet, (req) => thorchain.getTx(req)],
      [KnownChainIds.MayachainMainnet, (req) => mayachain.getTx(req)],
      [KnownChainIds.SolanaMainnet, (req) => solana.getTransaction(req)],
    ]

    for (const [chainId, getTx] of nodes) this.fetchers.set(chainId, unchainedFetcher(getTx))
  }

  async getTimestamp(chainId: ChainId, txid: string): Promise<TxLookup> {
    const fetcher = this.fetchers.get(chainId)
    if (!fetcher) return { outcome: 'unsupported' }

    try {
      return await fetcher(txid)
    } catch (error) {
      this.logger.warn(`Tx lookup failed for ${txid} on ${chainId}: ${error instanceof Error ? error.message : error}`)

      return { outcome: 'error' }
    }
  }
}
