import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

import { ATTRIBUTION_BATCH_SIZE } from '../swaps/constants'
import { SwapsService } from '../swaps/swaps.service'
import type { Swap } from '../swaps/types'
import { pollIntervalMs } from '../swaps/utils'
import { WebsocketGateway } from '../websocket/websocket.gateway'

const POLL_CONCURRENCY = 10
// ticks drift by a few ms, so a swap due on every tick isn't skipped when one lands just short of it
const POLL_TICK_SLACK_MS = 1000

const swapIds = (swaps: Swap[]): string => swaps.map((swap) => swap.swapId).join(', ')

@Injectable()
export class SwapPollingService {
  private readonly logger = new Logger(SwapPollingService.name)

  private isPollingTx = false
  private isPollingVerification = false
  private isPollingAttribution = false
  private isPollingPrices = false
  private isAbandoning = false

  // in memory is enough with one replica: a restart only costs each swap one early poll
  private readonly lastTxPollAt = new Map<string, number>()
  // last status change or new hash, which restarts the backoff
  private readonly lastProgressAt = new Map<string, number>()

  constructor(
    private swapsService: SwapsService,
    private websocketGateway: WebsocketGateway,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollPendingTxStatus() {
    if (this.isPollingTx) return
    this.isPollingTx = true

    try {
      const pending = await this.swapsService.getPendingTxSwaps()
      const now = Date.now()

      const pendingIds = new Set(pending.map((swap) => swap.swapId))
      for (const map of [this.lastTxPollAt, this.lastProgressAt]) {
        for (const swapId of map.keys()) if (!pendingIds.has(swapId)) map.delete(swapId)
      }

      const swaps = pending.filter((swap) => {
        const activeSince = this.lastProgressAt.get(swap.swapId) ?? swap.createdAt.getTime()
        return now - (this.lastTxPollAt.get(swap.swapId) ?? 0) >= pollIntervalMs(now - activeSince) - POLL_TICK_SLACK_MS
      })
      if (swaps.length === 0) return

      swaps.forEach((swap) => this.lastTxPollAt.set(swap.swapId, now))

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

  @Cron(CronExpression.EVERY_10_MINUTES)
  async pollPendingAttribution() {
    if (this.isPollingAttribution) return
    this.isPollingAttribution = true

    try {
      const swaps = await this.swapsService.getPendingAttributionSwaps()
      if (swaps.length === 0) return

      if (swaps.length >= ATTRIBUTION_BATCH_SIZE) {
        this.logger.warn(
          `Attribution backlog fills the batch (${ATTRIBUTION_BATCH_SIZE}); pending swaps between the newest and oldest wait for a later pass`,
        )
      }

      this.logger.log(`Polling attribution for ${swaps.length} swaps (${swapIds(swaps)})`)
      await this.runWorkers(swaps, (swap) => this.pollAttribution(swap))
    } catch (err) {
      this.logger.error('Failed to poll pending attribution:', err)
    } finally {
      this.isPollingAttribution = false
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async abandonUnbroadcastSwaps() {
    if (this.isAbandoning) return
    this.isAbandoning = true

    try {
      const abandoned = await this.swapsService.abandonUnbroadcastSwaps()
      if (abandoned.length === 0) return

      this.logger.log(`Abandoned ${abandoned.length} swaps that never reported a transaction (${swapIds(abandoned)})`)
      abandoned.forEach((swap) => this.websocketGateway.sendSwapUpdateToUser(swap.userId, swap))
    } catch (err) {
      this.logger.error('Failed to abandon unbroadcast swaps:', err)
    } finally {
      this.isAbandoning = false
    }
  }

  // hourly keeps a price that never resolves off the shared CoinGecko quota
  @Cron(CronExpression.EVERY_HOUR)
  async pollMissingPrices() {
    if (this.isPollingPrices) return
    this.isPollingPrices = true

    try {
      const swaps = await this.swapsService.getMissingPriceSwaps()
      if (swaps.length === 0) return

      this.logger.log(`Retrying USD prices for ${swaps.length} swaps (${swapIds(swaps)})`)
      await this.runWorkers(swaps, (swap) => this.fillPrices(swap))
    } catch (err) {
      this.logger.error('Failed to poll missing prices:', err)
    } finally {
      this.isPollingPrices = false
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

      // messages can change every poll (errors, confirmation counts), so only these count as progress
      const hasNewSellTxHash = !!statusUpdate.sellTxHash && statusUpdate.sellTxHash !== swap.sellTxHash
      const hasNewBuyTxHash = !!statusUpdate.buyTxHash && statusUpdate.buyTxHash !== swap.buyTxHash

      if (statusUpdate.status !== swap.status || hasNewSellTxHash || hasNewBuyTxHash) {
        this.lastProgressAt.set(swap.swapId, Date.now())
      }

      if (statusUpdate.status !== swap.status) {
        const updated = await this.swapsService.updateSwapStatus({
          swapId: swap.swapId,
          status: statusUpdate.status,
          sellTxHash: statusUpdate.sellTxHash,
          buyTxHash: statusUpdate.buyTxHash,
          txLink: statusUpdate.txLink,
          statusMessage: statusUpdate.statusMessage,
        })

        this.logger.log(`Status changed for swap ${swap.swapId}: ${swap.status} -> ${statusUpdate.status}`)
        this.websocketGateway.sendSwapUpdateToUser(updated.userId, updated)
        return
      }

      // Same status, but a hash, tracker link, or message the row did not have yet
      const hasNewTxLink = !!statusUpdate.txLink && statusUpdate.txLink !== swap.txLink
      const hasNewStatusMessage = !!statusUpdate.statusMessage && statusUpdate.statusMessage !== swap.statusMessage

      if (hasNewSellTxHash || hasNewBuyTxHash || hasNewTxLink || hasNewStatusMessage) {
        const updated = await this.swapsService.updateSwapTxHashes({
          swapId: swap.swapId,
          sellTxHash: statusUpdate.sellTxHash,
          buyTxHash: statusUpdate.buyTxHash,
          txLink: statusUpdate.txLink,
          statusMessage: statusUpdate.statusMessage,
        })

        this.logger.log(`Transaction details reported for swap ${swap.swapId} (${statusUpdate.status})`)
        this.websocketGateway.sendSwapUpdateToUser(updated.userId, updated)
        return
      }
    } catch (err) {
      this.logger.error(`Failed to poll tx status for swap ${swap.swapId}:`, err)
    }
  }

  private async pollAttribution(swap: Swap): Promise<void> {
    try {
      const updated = await this.swapsService.resolveAttribution(swap)
      if (updated.attributionStatus !== swap.attributionStatus) {
        this.logger.log(
          `Attribution resolved for swap ${swap.swapId}: ${updated.attributionStatus} ${JSON.stringify(updated.attributionDetails)}`,
        )
      }
    } catch (err) {
      this.logger.error(`Failed to check attribution for swap ${swap.swapId}:`, err)
    }
  }

  private async fillPrices(swap: Swap): Promise<void> {
    try {
      const filled = await this.swapsService.fillMissingPrices(swap)
      if (filled > 0) this.logger.log(`Filled ${filled} USD prices for swap ${swap.swapId}`)
    } catch (err) {
      this.logger.error(`Failed to fill USD prices for swap ${swap.swapId}:`, err)
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
