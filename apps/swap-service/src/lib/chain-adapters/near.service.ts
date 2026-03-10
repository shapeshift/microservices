import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import { near } from '@shapeshiftoss/chain-adapters';
import { nearChainId } from '@shapeshiftoss/caip';
import type { ChainId } from '@shapeshiftoss/caip';

@Injectable()
export class NearChainAdapterService {
  private readonly logger = new Logger(NearChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeNearChainAdapter() {
    this.logger.log('Initializing Near chain adapter...');

    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();

    try {
      this.initializeNearAdapter(chainAdapterManager);
      this.logger.log('Near chain adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Near chain adapter:', error);
      throw error;
    }
  }

  private initializeNearAdapter(chainAdapterManager: Map<string, any>) {
    const nearRpcUrls = (process.env.VITE_NEAR_NODE_URLS || '')
      .split(',')
      .filter(Boolean);

    const nearAdapter = new near.ChainAdapter({
      rpcUrls:
        nearRpcUrls.length > 0 ? nearRpcUrls : ['https://rpc.mainnet.near.org'],
      fastNearApiUrl:
        process.env.VITE_NEAR_FAST_API_URL || 'https://api.fastnear.com',
    });

    chainAdapterManager.set(nearChainId, nearAdapter);
    this.logger.log('Near adapter initialized');
  }

  assertGetNearChainAdapter(chainId: ChainId): near.ChainAdapter {
    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!adapter) {
      throw new Error(`Near chain adapter not found for chain ${chainId}`);
    }

    return adapter as near.ChainAdapter;
  }
}
