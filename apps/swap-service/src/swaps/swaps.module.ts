import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'

import { BlockTimeService } from '../lib/block-time.service'
import { ChainAdaptersModule } from '../lib/chain-adapters.module'
import { DepositDetectionService } from '../lib/deposit-detection.service'
import { SwapPollingService } from '../polling/swap-polling.service'
import { SwapVerificationService } from '../verification/swap-verification.service'
import { WebsocketGateway } from '../websocket/websocket.gateway'

import { SwapsController } from './swaps.controller'
import { SwapsService } from './swaps.service'

@Module({
  // a hung upstream would otherwise hold a polling worker forever
  imports: [HttpModule.register({ timeout: 15_000 }), ChainAdaptersModule],
  controllers: [SwapsController],
  providers: [
    SwapsService,
    SwapPollingService,
    SwapVerificationService,
    DepositDetectionService,
    BlockTimeService,
    WebsocketGateway,
  ],
  exports: [SwapsService],
})
export class SwapsModule {}
