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
    const statusUpdate = await (async () => {
      try {
        return await this.swapsService.pollSwapStatus(swap.swapId)
      } catch (err) {
        this.logger.error(`Failed to poll swap ${swap.swapId}:`, err)
        return
      }
    })()

    if (!statusUpdate || statusUpdate.status === swap.status) return

    this.logger.log(`Status changed for swap ${swap.swapId}: ${swap.status} -> ${statusUpdate.status}`)

    try {
      const updatedSwap = await this.swapsService.updateSwapStatus({
        swapId: swap.swapId,
        status: statusUpdate.status,
        sellTxHash: statusUpdate.sellTxHash,
        buyTxHash: statusUpdate.buyTxHash,
        statusMessage: statusUpdate.statusMessage,
      })

      this.websocketGateway.sendSwapUpdateToUser(swap.userId, updatedSwap)
    } catch (error) {
      this.logger.error(`Failed to persist status change for swap ${swap.swapId}:`, error)
    }
  }
}
