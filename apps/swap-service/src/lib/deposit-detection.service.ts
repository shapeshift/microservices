import { OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript'
import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'

import type { ChainId } from '@shapeshiftoss/caip'
import { SwapperName } from '@shapeshiftoss/swapper'
import type { UtxoChainId } from '@shapeshiftoss/types'
import { KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../env'
import type { Swap } from '../swaps/types'
import { describeError } from '../swaps/utils'
import { getSwapMetadata } from '../verification/utils'

// Non-exhaustive - only the deposit leg of the broker's status-by-id response
type ChainflipStatusResponse = {
  status?: {
    deposit?: { transactionReference?: string | null }
  }
}

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

// A deposit address's history is the deposits into it and the provider's sweeps out of it. The
// earliest transaction that pays it without spending from it is the deposit, whatever funded it.
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
 * Finds the transaction that funded an externally paid swap. The client that registered the swap
 * may never see that transaction, so the provider is asked first; when it reports none - a shielded
 * zcash spend has no input it can attribute - the deposit address's own history is searched.
 */
@Injectable()
export class DepositDetectionService {
  private readonly logger = new Logger(DepositDetectionService.name)
  private readonly utxoHistory = new Map<ChainId, UtxoTxHistory>()

  constructor(private readonly httpService: HttpService) {
    OpenAPI.BASE = 'https://1click.chaindefuser.com'
    OpenAPI.TOKEN = env.VITE_NEAR_INTENTS_API_KEY

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

  async findDepositTxHash(swap: Swap): Promise<string | undefined> {
    try {
      const reported = await this.findProviderReportedTxHash(swap)
      if (reported) return reported

      return await this.findDepositOnChain(swap)
    } catch (error) {
      this.logger.warn(`Deposit lookup failed for swap ${swap.swapId}: ${describeError(error)}`)
      return undefined
    }
  }

  private async findProviderReportedTxHash(swap: Swap): Promise<string | undefined> {
    switch (swap.swapperName) {
      case SwapperName.Chainflip:
        return this.findChainflipDepositTxHash(swap)
      case SwapperName.NearIntents:
        return this.findNearIntentsDepositTxHash(swap)
      default:
        return undefined
    }
  }

  private async findChainflipDepositTxHash(swap: Swap): Promise<string | undefined> {
    const swapId = getSwapMetadata(swap.metadata, 'chainflip')?.swapId
    if (!swapId) throw new Error('Missing swapId in chainflip metadata')

    const url = `${env.VITE_CHAINFLIP_API_URL}/status-by-id?apiKey=${env.VITE_CHAINFLIP_API_KEY}&swapId=${swapId}`
    const response = await firstValueFrom(this.httpService.get<ChainflipStatusResponse>(url))

    return response.data?.status?.deposit?.transactionReference || undefined
  }

  private async findNearIntentsDepositTxHash(swap: Swap): Promise<string | undefined> {
    const depositAddress = this.nearIntentsDepositAddress(swap)

    const status = await OneClickService.getExecutionStatus(depositAddress)

    return status.swapDetails?.originChainTxHashes?.[0]?.hash || undefined
  }

  private nearIntentsDepositAddress(swap: Swap): string {
    const depositAddress = getSwapMetadata(swap.metadata, 'nearIntents')?.depositAddress
    if (!depositAddress) throw new Error('Missing depositAddress in nearIntents metadata')
    return depositAddress
  }

  private async findDepositOnChain(swap: Swap): Promise<string | undefined> {
    // Chainflip attributes every deposit it credits; only NEAR Intents leaves some unreported
    if (swap.swapperName !== SwapperName.NearIntents) return undefined

    const history = this.utxoHistory.get(swap.sellAsset.chainId)
    if (!history) return undefined

    const depositAddress = this.nearIntentsDepositAddress(swap)
    const { txs } = await history(depositAddress)

    return findDepositInHistory(txs, depositAddress)
  }
}
