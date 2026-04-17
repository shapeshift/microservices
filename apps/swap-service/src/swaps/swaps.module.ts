import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'

import { ChainAdaptersModule } from '../lib/chain-adapters.module'
import { SwapPollingService } from '../polling/swap-polling.service'
import { SwapVerificationService } from '../verification/swap-verification.service'
import { WebsocketGateway } from '../websocket/websocket.gateway'

import { SwapsController } from './swaps.controller'
import { SwapsService } from './swaps.service'

@Module({
  imports: [HttpModule, ChainAdaptersModule],
  controllers: [SwapsController],
  providers: [SwapsService, SwapPollingService, SwapVerificationService, WebsocketGateway],
  exports: [SwapsService],
})
export class SwapsModule {}
