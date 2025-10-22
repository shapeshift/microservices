import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from './chain-adapter-manager.service';
import { EvmChainAdapterService } from './chain-adapters/evm.service';
import { UtxoChainAdapterService } from './chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from './chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from './chain-adapters/solana.service';

@Injectable()
export class ChainAdapterInitService {
  private readonly logger = new Logger(ChainAdapterInitService.name);

  constructor(
    private chainAdapterManagerService: ChainAdapterManagerService,
    private evmChainAdapterService: EvmChainAdapterService,
    private utxoChainAdapterService: UtxoChainAdapterService,
    private cosmosSdkChainAdapterService: CosmosSdkChainAdapterService,
    private solanaChainAdapterService: SolanaChainAdapterService,
  ) {}

  async initializeChainAdapters() {
    this.logger.log('Initializing chain adapters...');

    try {
      await this.evmChainAdapterService.initializeEvmChainAdapters();
      
      await this.utxoChainAdapterService.initializeUtxoChainAdapters();
      
      await this.cosmosSdkChainAdapterService.initializeCosmosSdkChainAdapters();
      
      await this.solanaChainAdapterService.initializeSolanaChainAdapter();

      this.logger.log('All chain adapters initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize chain adapters:', error);
      throw error;
    }
  }

  getChainAdapterManager() {
    return this.chainAdapterManagerService.getChainAdapterManager();
  }
}
