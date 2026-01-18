import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { PrismaService } from './prisma/prisma.service';
import { SwapsController } from './swaps/swaps.controller';
import { SwapsService } from './swaps/swaps.service';
import { SwapPollingService } from './polling/swap-polling.service';
import { SwapVerificationService } from './verification/swap-verification.service';
import { WebsocketGateway } from './websocket/websocket.gateway';
import { ChainAdapterInitService } from './lib/chain-adapter-init.service';
import { ChainAdapterManagerService } from './lib/chain-adapter-manager.service';
import { EvmChainAdapterService } from './lib/chain-adapters/evm.service';
import { UtxoChainAdapterService } from './lib/chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from './lib/chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from './lib/chain-adapters/solana.service';
import { ConfigModule } from '@nestjs/config';
import { RoutingModule } from './routing/routing.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    ConfigModule.forRoot({
      envFilePath: '../../.env',
    }),
    RoutingModule,
  ],
  controllers: [SwapsController],
  providers: [
    PrismaService,
    SwapsService,
    SwapPollingService,
    SwapVerificationService,
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
