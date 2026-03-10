import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import { starknet } from '@shapeshiftoss/chain-adapters';
import { starknetChainId } from '@shapeshiftoss/caip';
import type { ChainId } from '@shapeshiftoss/caip';

@Injectable()
export class StarknetChainAdapterService {
  private readonly logger = new Logger(StarknetChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeStarknetChainAdapter() {
    this.logger.log('Initializing Starknet chain adapter...');

    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();

    try {
      this.initializeStarknetAdapter(chainAdapterManager);
      this.logger.log('Starknet chain adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Starknet chain adapter:', error);
      throw error;
    }
  }

  private initializeStarknetAdapter(chainAdapterManager: Map<string, any>) {
    const starknetAdapter = new starknet.ChainAdapter({
      rpcUrl: process.env.VITE_STARKNET_NODE_URL || '',
    });

    chainAdapterManager.set(starknetChainId, starknetAdapter);
    this.logger.log('Starknet adapter initialized');
  }

  assertGetStarknetChainAdapter(chainId: ChainId): starknet.ChainAdapter {
    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!adapter) {
      throw new Error(`Starknet chain adapter not found for chain ${chainId}`);
    }

    return adapter as starknet.ChainAdapter;
  }
}
