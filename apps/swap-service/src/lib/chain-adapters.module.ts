import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'

import { ChainAdapterInitService } from './chain-adapter-init.service'
import { ChainAdapterManagerService } from './chain-adapter-manager.service'
import { CosmosSdkChainAdapterService } from './chain-adapters/cosmos-sdk.service'
import { EvmChainAdapterService } from './chain-adapters/evm.service'
import { NearChainAdapterService } from './chain-adapters/near.service'
import { SolanaChainAdapterService } from './chain-adapters/solana.service'
import { StarknetChainAdapterService } from './chain-adapters/starknet.service'
import { SuiChainAdapterService } from './chain-adapters/sui.service'
import { TonChainAdapterService } from './chain-adapters/ton.service'
import { TronChainAdapterService } from './chain-adapters/tron.service'
import { UtxoChainAdapterService } from './chain-adapters/utxo.service'

const adapters = [
  EvmChainAdapterService,
  UtxoChainAdapterService,
  CosmosSdkChainAdapterService,
  SolanaChainAdapterService,
  TronChainAdapterService,
  SuiChainAdapterService,
  NearChainAdapterService,
  StarknetChainAdapterService,
  TonChainAdapterService,
]

@Module({
  imports: [HttpModule],
  providers: [ChainAdapterInitService, ChainAdapterManagerService, ...adapters],
  exports: [ChainAdapterManagerService, ...adapters],
})
export class ChainAdaptersModule {}
