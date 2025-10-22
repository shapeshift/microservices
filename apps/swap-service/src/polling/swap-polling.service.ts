import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SwapsService } from '../swaps/swaps.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class SwapPollingService {
  private readonly logger = new Logger(SwapPollingService.name);

  constructor(
    private swapsService: SwapsService,
    private websocketGateway: WebsocketGateway,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollPendingSwaps() {
    try {
      this.logger.log('Starting to poll pending swaps...');
      
      const pendingSwaps = await this.swapsService.getPendingSwaps();
      
      if (pendingSwaps.length === 0) {
        this.logger.log('No pending swaps found');
        return;
      }

      this.logger.log(`Found ${pendingSwaps.length} pending swaps to poll`);

      for (const swap of pendingSwaps) {
        try {
          const statusUpdate = await this.swapsService.pollSwapStatus(swap.swapId);
          
          if (statusUpdate.status !== swap.status) {
            this.logger.log(`Status changed for swap ${swap.swapId}: ${swap.status} -> ${statusUpdate.status}`);
            
            const updatedSwap = await this.swapsService.updateSwapStatus({
              swapId: swap.swapId,
              status: statusUpdate.status,
              sellTxHash: statusUpdate.sellTxHash,
              buyTxHash: statusUpdate.buyTxHash,
              statusMessage: statusUpdate.statusMessage,
            });

            await this.websocketGateway.sendSwapUpdateToUser(swap.userId, updatedSwap);
          }
        } catch (error) {
          this.logger.error(`Failed to poll swap ${swap.swapId}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to poll pending swaps:', error);
    }
  }
}
