import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import { SwapperName } from '@shapeshiftoss/swapper'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import type { Swap } from '../swaps/types'
import { describeError } from '../swaps/utils'
import { getSwapMetadata } from '../verification/utils'

import { UTXO_URLS, unchainedApi } from './unchained'

type UtxoTx = {
  txid: string
  blockHeight: number
  timestamp: number
  vin: { addresses?: string[] }[]
  vout: { addresses?: string[] }[]
}

type UtxoTxHistory = (pubkey: string) => Promise<{ txs: UtxoTx[] }>

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
    const utxoApis: [ChainId, UtxoTxHistory][] = [
      [
        KnownChainIds.BitcoinMainnet,
        this.txHistory(unchainedApi(unchained.bitcoin, UTXO_URLS[KnownChainIds.BitcoinMainnet])),
      ],
      [
        KnownChainIds.BitcoinCashMainnet,
        this.txHistory(unchainedApi(unchained.bitcoincash, UTXO_URLS[KnownChainIds.BitcoinCashMainnet])),
      ],
      [
        KnownChainIds.DogecoinMainnet,
        this.txHistory(unchainedApi(unchained.dogecoin, UTXO_URLS[KnownChainIds.DogecoinMainnet])),
      ],
      [
        KnownChainIds.LitecoinMainnet,
        this.txHistory(unchainedApi(unchained.litecoin, UTXO_URLS[KnownChainIds.LitecoinMainnet])),
      ],
      [
        KnownChainIds.ZcashMainnet,
        this.txHistory(unchainedApi(unchained.zcash, UTXO_URLS[KnownChainIds.ZcashMainnet])),
      ],
    ]
    for (const [chainId, history] of utxoApis) this.utxoHistory.set(chainId, history)
  }

  private txHistory(api: {
    getTxHistory: (req: { pubkey: string; pageSize?: number }) => Promise<{ txs: UtxoTx[] }>
  }): UtxoTxHistory {
    return (pubkey) => api.getTxHistory({ pubkey, pageSize: HISTORY_PAGE_SIZE })
  }

  async findDepositOnChain(swap: Swap): Promise<string | undefined> {
    // Chainflip attributes every deposit it credits; only NEAR Intents leaves some unreported
    if (swap.swapperName !== SwapperName.NearIntents) return undefined

    const history = this.utxoHistory.get(swap.sellAsset.chainId)
    if (!history) return undefined

    const depositAddress = getSwapMetadata(swap.metadata, 'nearIntents')?.depositAddress
    if (!depositAddress) {
      this.logger.warn(`Swap ${swap.swapId} has no depositAddress in its nearIntents metadata`)
      return undefined
    }

    try {
      const { txs } = await history(depositAddress)

      return findDepositInHistory(txs, depositAddress)
    } catch (error) {
      this.logger.warn(`Deposit lookup failed for swap ${swap.swapId}: ${describeError(error)}`)
      return undefined
    }
  }
}
