import { Injectable, Logger } from '@nestjs/common'

import { zecChainId } from '@shapeshiftoss/caip'
import { SwapperName } from '@shapeshiftoss/swapper'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import type { Swap } from '../swaps/types'
import { describeError } from '../swaps/utils'
import { getSwapMetadata } from '../verification/utils'

import { unchainedApi, UTXO_URLS } from './unchained'

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

// A shielded zcash spend has no input NEAR Intents can attribute, so the deposit address's own history is searched
@Injectable()
export class DepositDetectionService {
  private readonly logger = new Logger(DepositDetectionService.name)
  private readonly zcashHistory: UtxoTxHistory

  constructor() {
    const api = unchainedApi(unchained.zcash, UTXO_URLS[KnownChainIds.ZcashMainnet])

    this.zcashHistory = (pubkey) => api.getTxHistory({ pubkey, pageSize: HISTORY_PAGE_SIZE })
  }

  async findDepositOnChain(swap: Swap): Promise<string | undefined> {
    if (swap.swapperName !== SwapperName.NearIntents) return
    if (swap.sellAsset.chainId !== zecChainId) return

    const depositAddress = getSwapMetadata(swap.metadata, 'nearIntents')?.depositAddress
    if (!depositAddress) {
      this.logger.warn(`Swap ${swap.swapId} has no depositAddress in its nearIntents metadata`)
      return
    }

    try {
      const { txs } = await this.zcashHistory(depositAddress)

      return findDepositInHistory(txs, depositAddress)
    } catch (error) {
      this.logger.warn(`Deposit lookup failed for swap ${swap.swapId}: ${describeError(error)}`)
      return
    }
  }
}
