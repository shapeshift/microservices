import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import { SwapsController } from './swaps/swaps.controller';
import { SwapsService } from './swaps/swaps.service';
import { SwapPollingService } from './polling/swap-polling.service';
import { WebsocketGateway } from './websocket/websocket.gateway';
import { ChainAdapterInitService } from './lib/chain-adapter-init.service';
import { ChainAdapterManagerService } from './lib/chain-adapter-manager.service';
import { EvmChainAdapterService } from './lib/chain-adapters/evm.service';
import { UtxoChainAdapterService } from './lib/chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from './lib/chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from './lib/chain-adapters/solana.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule.forRoot({
    envFilePath: '../../.env',
  })],
  controllers: [SwapsController],
  providers: [
    PrismaService,
    SwapsService,
    SwapPollingService,
    WebsocketGateway,
    ChainAdapterInitService,
    ChainAdapterManagerService,
    EvmChainAdapterService,
    UtxoChainAdapterService,
    CosmosSdkChainAdapterService,
    SolanaChainAdapterService,
  ],
})
export class AppModule {}
