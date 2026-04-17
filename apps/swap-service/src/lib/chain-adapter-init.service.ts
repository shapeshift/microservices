import { Injectable, Logger } from '@nestjs/common'

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

@Injectable()
export class ChainAdapterInitService {
  private readonly logger = new Logger(ChainAdapterInitService.name)

  constructor(
    private chainAdapterManagerService: ChainAdapterManagerService,
    private evmChainAdapterService: EvmChainAdapterService,
    private utxoChainAdapterService: UtxoChainAdapterService,
    private cosmosSdkChainAdapterService: CosmosSdkChainAdapterService,
    private solanaChainAdapterService: SolanaChainAdapterService,
    private tronChainAdapterService: TronChainAdapterService,
    private suiChainAdapterService: SuiChainAdapterService,
    private nearChainAdapterService: NearChainAdapterService,
    private starknetChainAdapterService: StarknetChainAdapterService,
    private tonChainAdapterService: TonChainAdapterService,
  ) {}

  initializeChainAdapters() {
    this.logger.log('Initializing chain adapters...')

    try {
      this.evmChainAdapterService.initializeEvmChainAdapters()
      this.utxoChainAdapterService.initializeUtxoChainAdapters()
      this.cosmosSdkChainAdapterService.initializeCosmosSdkChainAdapters()
      this.solanaChainAdapterService.initializeSolanaChainAdapter()
      this.tronChainAdapterService.initializeTronChainAdapter()
      this.suiChainAdapterService.initializeSuiChainAdapter()
      this.nearChainAdapterService.initializeNearChainAdapter()
      this.starknetChainAdapterService.initializeStarknetChainAdapter()
      this.tonChainAdapterService.initializeTonChainAdapter()

      this.logger.log('All chain adapters initialized successfully')
    } catch (error) {
      this.logger.error('Failed to initialize chain adapters:', error)
      throw error
    }
  }

  getChainAdapterManager() {
    return this.chainAdapterManagerService.getChainAdapterManager()
  }
}
