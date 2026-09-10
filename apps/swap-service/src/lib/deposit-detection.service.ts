import { OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript'
import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'

import { SwapperName } from '@shapeshiftoss/swapper'

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

/**
 * Finds the transaction that funded an externally paid swap. The client that registered the swap
 * may never see that transaction, so the provider is the source of truth for it.
 */
@Injectable()
export class DepositDetectionService {
  private readonly logger = new Logger(DepositDetectionService.name)

  constructor(private readonly httpService: HttpService) {
    OpenAPI.BASE = 'https://1click.chaindefuser.com'
    OpenAPI.TOKEN = env.VITE_NEAR_INTENTS_API_KEY
  }

  async findDepositTxHash(swap: Swap): Promise<string | undefined> {
    try {
      switch (swap.swapperName) {
        case SwapperName.Chainflip:
          return await this.findChainflipDepositTxHash(swap)
        case SwapperName.NearIntents:
          return await this.findNearIntentsDepositTxHash(swap)
        default:
          return undefined
      }
    } catch (error) {
      this.logger.warn(`Deposit lookup failed for swap ${swap.swapId}: ${describeError(error)}`)
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
    const depositAddress = getSwapMetadata(swap.metadata, 'nearIntents')?.depositAddress
    if (!depositAddress) throw new Error('Missing depositAddress in nearIntents metadata')

    const status = await OneClickService.getExecutionStatus(depositAddress)

    return status.swapDetails?.originChainTxHashes?.[0]?.hash || undefined
  }
}
