import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { SwapsService } from '../swaps/swaps.service'
import { WebsocketGateway } from '../websocket/websocket.gateway'

const POLL_CONCURRENCY = 10

@Injectable()
export class SwapPollingService {
  private readonly logger = new Logger(SwapPollingService.name)

  private isPolling = false

  constructor(
    private swapsService: SwapsService,
    private websocketGateway: WebsocketGateway,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollPendingSwaps() {
    if (this.isPolling) return
    this.isPolling = true

    try {
      // TODO: paginate with a batch size + oldest-first ordering once the in-flight
      // queue grows enough that one cron tick can't drain it within the 5s interval.
      const pendingSwaps = await this.swapsService.getPendingSwaps()
      if (pendingSwaps.length === 0) return

      this.logger.log(`Polling ${pendingSwaps.length} pending swaps`)

      const queue = [...pendingSwaps]
      const workers = Array.from({ length: Math.min(POLL_CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const swap = queue.shift()
          if (swap) await this.pollOne(swap)
        }
      })
      await Promise.all(workers)
    } catch (err) {
      this.logger.error('Failed to poll pending swaps:', err)
    } finally {
      this.isPolling = false
    }
  }

  private async pollOne(swap: Awaited<ReturnType<SwapsService['getPendingSwaps']>>[number]): Promise<void> {
    let current = swap

    if (current.status === 'IDLE' || current.status === 'PENDING') {
      try {
        const statusUpdate = await this.swapsService.pollSwapStatus(current.swapId)

        if (statusUpdate.status !== current.status) {
          this.logger.log(`Status changed for swap ${current.swapId}: ${current.status} -> ${statusUpdate.status}`)

          current = await this.swapsService.updateSwapStatus({
            swapId: current.swapId,
            status: statusUpdate.status,
            sellTxHash: statusUpdate.sellTxHash,
            buyTxHash: statusUpdate.buyTxHash,
            statusMessage: statusUpdate.statusMessage,
          })

          this.websocketGateway.sendSwapUpdateToUser(current.userId, current)
        }
      } catch (err) {
        this.logger.error(`Failed to poll tx status for swap ${current.swapId}:`, err)
      }
    }

    if (current.verificationStatus !== 'PENDING') return

    try {
      if (current.status === 'SUCCESS') {
        const updated = await this.swapsService.verifySwap(current)
        if (updated.verificationStatus !== current.verificationStatus) {
          this.logger.log(
            `Verification changed for swap ${current.swapId}: ${current.verificationStatus} -> ${updated.verificationStatus}`,
          )
          this.websocketGateway.sendSwapUpdateToUser(updated.userId, updated)
        }
      } else if (current.status === 'FAILED') {
        const updated = await this.swapsService.markVerificationFailed(current.swapId)
        this.logger.log(`Verification short-circuited to FAILED for swap ${current.swapId} (tx FAILED)`)
        this.websocketGateway.sendSwapUpdateToUser(updated.userId, updated)
      }
    } catch (err) {
      this.logger.error(`Failed to verify swap ${current.swapId}:`, err)
    }
  }
}
