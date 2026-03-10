import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import * as unchained from '@shapeshiftoss/unchained-client';
import { tron } from '@shapeshiftoss/chain-adapters';
import { tronChainId } from '@shapeshiftoss/caip';
import type { ChainId } from '@shapeshiftoss/caip';

@Injectable()
export class TronChainAdapterService {
  private readonly logger = new Logger(TronChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeTronChainAdapter() {
    this.logger.log('Initializing Tron chain adapter...');

    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();

    try {
      this.initializeTronAdapter(chainAdapterManager);
      this.logger.log('Tron chain adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Tron chain adapter:', error);
      throw error;
    }
  }

  private initializeTronAdapter(chainAdapterManager: Map<string, any>) {
    const tronHttp = new unchained.tron.TronApi({
      rpcUrl: process.env.VITE_TRON_NODE_URL || '',
    });

    const tronAdapter = new tron.ChainAdapter({
      providers: { http: tronHttp },
      rpcUrl: process.env.VITE_TRON_NODE_URL || '',
    });

    chainAdapterManager.set(tronChainId, tronAdapter);
    this.logger.log('Tron adapter initialized');
  }

  assertGetTronChainAdapter(chainId: ChainId): tron.ChainAdapter {
    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!adapter) {
      throw new Error(`Tron chain adapter not found for chain ${chainId}`);
    }

    return adapter as tron.ChainAdapter;
  }
}
