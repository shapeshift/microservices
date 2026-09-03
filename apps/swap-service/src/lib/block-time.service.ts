import { Injectable, Logger } from '@nestjs/common'
import type { PublicClient } from 'viem'
import { BlockNotFoundError, TransactionNotFoundError } from 'viem'

import type { ChainId } from '@shapeshiftoss/caip'
import { viemClientByChainId } from '@shapeshiftoss/contracts'
import type { CosmosSdkChainId, UtxoChainId } from '@shapeshiftoss/types'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../env'

export type BlockTimeLookup = { blockTime: number } | { unavailable: 'unsupported' | 'not-found' | 'error' }

type ChainLookup = (txid: string) => Promise<BlockTimeLookup>
type GetTx = (req: { txid: string }) => Promise<{ timestamp: number }>

const viemLookup =
  (client: PublicClient): ChainLookup =>
  async (txid) => {
    try {
      const tx = await client.getTransaction({ hash: txid as `0x${string}` })

      // seen but still unmined, which says nothing about when it was broadcast
      if (tx.blockNumber === null) return { unavailable: 'not-found' }

      const block = await client.getBlock({ blockNumber: tx.blockNumber })

      return { blockTime: Number(block.timestamp) }
    } catch (error) {
      if (error instanceof TransactionNotFoundError || error instanceof BlockNotFoundError) {
        return { unavailable: 'not-found' }
      }

      throw error
    }
  }

const unchainedLookup =
  (getTx: GetTx): ChainLookup =>
  async (txid) => {
    try {
      const { timestamp } = await getTx({ txid })

      return { blockTime: timestamp }
    } catch (error) {
      if (error instanceof unchained.ResponseError && error.response.status === 404) return { unavailable: 'not-found' }

      throw error
    }
  }

const unchainedApi = <C, A>(
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
export class BlockTimeService {
  private readonly logger = new Logger(BlockTimeService.name)
  private readonly lookups = new Map<ChainId, ChainLookup>()

  constructor() {
    for (const [chainId, client] of Object.entries(viemClientByChainId)) {
      this.lookups.set(chainId, viemLookup(client))
    }

    const btc = unchainedApi(unchained.bitcoin, UTXO_URLS[KnownChainIds.BitcoinMainnet])
    const bch = unchainedApi(unchained.bitcoincash, UTXO_URLS[KnownChainIds.BitcoinCashMainnet])
    const doge = unchainedApi(unchained.dogecoin, UTXO_URLS[KnownChainIds.DogecoinMainnet])
    const ltc = unchainedApi(unchained.litecoin, UTXO_URLS[KnownChainIds.LitecoinMainnet])
    const zec = unchainedApi(unchained.zcash, UTXO_URLS[KnownChainIds.ZcashMainnet])
    const cosmos = unchainedApi(unchained.cosmos, COSMOS_SDK_URLS[KnownChainIds.CosmosMainnet])
    const thorchain = unchainedApi(unchained.thorchain, COSMOS_SDK_URLS[KnownChainIds.ThorchainMainnet])
    const mayachain = unchainedApi(unchained.mayachain, COSMOS_SDK_URLS[KnownChainIds.MayachainMainnet])
    const solana = unchainedApi(unchained.solana, env.VITE_UNCHAINED_SOLANA_HTTP_URL)

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

    for (const [chainId, getTx] of nodes) this.lookups.set(chainId, unchainedLookup(getTx))
  }

  async lookup(chainId: ChainId, txid: string): Promise<BlockTimeLookup> {
    const chainLookup = this.lookups.get(chainId)
    if (!chainLookup) return { unavailable: 'unsupported' }

    try {
      return await chainLookup(txid)
    } catch (error) {
      this.logger.warn(
        `Block time lookup failed for ${txid} on ${chainId}: ${error instanceof Error ? error.message : error}`,
      )

      return { unavailable: 'error' }
    }
  }
}
