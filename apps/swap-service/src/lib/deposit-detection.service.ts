import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import { SwapperName } from '@shapeshiftoss/swapper'
import type { UtxoChainId } from '@shapeshiftoss/types'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../env'
import type { Swap } from '../swaps/types'
import { describeError } from '../swaps/utils'
import { getSwapMetadata } from '../verification/utils'

type UtxoTx = {
  txid: string
  blockHeight: number
  timestamp: number
  vin: { addresses?: string[] }[]
  vout: { addresses?: string[] }[]
}

type UtxoTxHistory = (pubkey: string) => Promise<{ txs: UtxoTx[] }>

const unchainedApi = <C, A>(
  namespace: { V1Api: new (config: C) => A; Configuration: new (params: { basePath: string }) => C },
  basePath: string,
): A => new namespace.V1Api(new namespace.Configuration({ basePath }))

const HISTORY_PAGE_SIZE = 25

// The earliest transaction paying the address without spending from it is the deposit; the rest are sweeps
export const findDepositInHistory = (txs: UtxoTx[], depositAddress: string): string | undefined => {
  const deposits = txs.filter(
    (tx) =>
      tx.vout.some((out) => out.addresses?.includes(depositAddress)) &&
      !tx.vin.some((input) => input.addresses?.includes(depositAddress)),
  )

  // Unmined transactions carry no height, so they sort last as the most recent
  const height = (tx: UtxoTx): number => (tx.blockHeight > 0 ? tx.blockHeight : Number.MAX_SAFE_INTEGER)

  return deposits.sort((a, b) => height(a) - height(b) || a.timestamp - b.timestamp)[0]?.txid
}

/**
 * Finds a deposit the provider never reported - a shielded zcash spend has no input NEAR Intents can
 * attribute - by searching the deposit address's own history on the sell chain.
 */
@Injectable()
export class DepositDetectionService {
  private readonly logger = new Logger(DepositDetectionService.name)
  private readonly utxoHistory = new Map<ChainId, UtxoTxHistory>()

  constructor() {
    const utxoApis: [UtxoChainId, UtxoTxHistory][] = [
      [
        KnownChainIds.BitcoinMainnet,
        this.txHistory(unchainedApi(unchained.bitcoin, env.VITE_UNCHAINED_BITCOIN_HTTP_URL)),
      ],
      [
        KnownChainIds.BitcoinCashMainnet,
        this.txHistory(unchainedApi(unchained.bitcoincash, env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL)),
      ],
      [
        KnownChainIds.DogecoinMainnet,
        this.txHistory(unchainedApi(unchained.dogecoin, env.VITE_UNCHAINED_DOGECOIN_HTTP_URL)),
      ],
      [
        KnownChainIds.LitecoinMainnet,
        this.txHistory(unchainedApi(unchained.litecoin, env.VITE_UNCHAINED_LITECOIN_HTTP_URL)),
      ],
      [KnownChainIds.ZcashMainnet, this.txHistory(unchainedApi(unchained.zcash, env.VITE_UNCHAINED_ZCASH_HTTP_URL))],
    ]
    for (const [chainId, history] of utxoApis) this.utxoHistory.set(chainId, history)
  }

  private txHistory(api: {
    getTxHistory: (req: { pubkey: string; pageSize?: number }) => Promise<unknown>
  }): UtxoTxHistory {
    return (pubkey) => api.getTxHistory({ pubkey, pageSize: HISTORY_PAGE_SIZE }) as Promise<{ txs: UtxoTx[] }>
  }

  async findDepositOnChain(swap: Swap): Promise<string | undefined> {
    // Chainflip attributes every deposit it credits; only NEAR Intents leaves some unreported
    if (swap.swapperName !== SwapperName.NearIntents) return undefined

    const history = this.utxoHistory.get(swap.sellAsset.chainId)
    if (!history) return undefined

    try {
      const depositAddress = getSwapMetadata(swap.metadata, 'nearIntents')?.depositAddress
      if (!depositAddress) throw new Error('Missing depositAddress in nearIntents metadata')

      const { txs } = await history(depositAddress)

      return findDepositInHistory(txs, depositAddress)
    } catch (error) {
      this.logger.warn(`Deposit lookup failed for swap ${swap.swapId}: ${describeError(error)}`)
      return undefined
    }
  }
}
