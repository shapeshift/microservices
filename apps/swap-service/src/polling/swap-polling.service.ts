import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { SwapsService } from '../swaps/swaps.service'
import type { Swap } from '../swaps/types'
import { WebsocketGateway } from '../websocket/websocket.gateway'

const POLL_CONCURRENCY = 10

const swapIds = (swaps: Swap[]): string => swaps.map((swap) => swap.swapId).join(', ')

@Injectable()
export class SwapPollingService {
  private readonly logger = new Logger(SwapPollingService.name)

  private isPollingTx = false
  private isPollingVerification = false

  constructor(
    private swapsService: SwapsService,
    private websocketGateway: WebsocketGateway,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollPendingTxStatus() {
    if (this.isPollingTx) return
    this.isPollingTx = true

    try {
      const swaps = await this.swapsService.getPendingTxSwaps()
      if (swaps.length === 0) return

      this.logger.log(`Polling tx status for ${swaps.length} swaps (${swapIds(swaps)})`)
      await this.runWorkers(swaps, (swap) => this.pollTxStatus(swap))
    } catch (err) {
      this.logger.error('Failed to poll pending tx status:', err)
    } finally {
      this.isPollingTx = false
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollPendingVerification() {
    if (this.isPollingVerification) return
    this.isPollingVerification = true

    try {
      const swaps = await this.swapsService.getPendingVerificationSwaps()
      if (swaps.length === 0) return

      this.logger.log(`Polling verification for ${swaps.length} swaps (${swapIds(swaps)})`)
      await this.runWorkers(swaps, (swap) => this.pollVerification(swap))
    } catch (err) {
      this.logger.error('Failed to poll pending verification:', err)
    } finally {
      this.isPollingVerification = false
    }
  }

  private async runWorkers(swaps: Swap[], handler: (swap: Swap) => Promise<void>): Promise<void> {
    const queue = [...swaps]
    const workers = Array.from({ length: Math.min(POLL_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const swap = queue.shift()
        if (swap) await handler(swap)
      }
    })
    await Promise.all(workers)
  }

  private async pollTxStatus(swap: Swap): Promise<void> {
    try {
      const statusUpdate = await this.swapsService.checkSwapStatus(swap.swapId)

      if (statusUpdate.status === swap.status) return

      this.logger.log(`Status changed for swap ${swap.swapId}: ${swap.status} -> ${statusUpdate.status}`)

      const updated = await this.swapsService.updateSwapStatus({
        swapId: swap.swapId,
        status: statusUpdate.status,
        sellTxHash: statusUpdate.sellTxHash,
        buyTxHash: statusUpdate.buyTxHash,
        statusMessage: statusUpdate.statusMessage,
      })

      this.websocketGateway.sendSwapUpdateToUser(updated.userId, updated)
    } catch (err) {
      this.logger.error(`Failed to poll tx status for swap ${swap.swapId}:`, err)
    }
  }

  private async pollVerification(swap: Swap): Promise<void> {
    try {
      const updated = await this.swapsService.verifySwap(swap)
      if (updated.verificationStatus !== swap.verificationStatus) {
        this.logger.log(
          `Verification changed for swap ${swap.swapId}: ${swap.verificationStatus} -> ${updated.verificationStatus}`,
        )
      }
    } catch (err) {
      this.logger.error(`Failed to verify swap ${swap.swapId}:`, err)
    }
  }
}
