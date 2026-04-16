import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import { ton } from '@shapeshiftoss/chain-adapters';
import { tonChainId } from '@shapeshiftoss/caip';
import type { ChainId } from '@shapeshiftoss/caip';

@Injectable()
export class TonChainAdapterService {
  private readonly logger = new Logger(TonChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeTonChainAdapter() {
    this.logger.log('Initializing Ton chain adapter...');

    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();

    try {
      this.initializeTonAdapter(chainAdapterManager);
    } catch (error) {
      this.logger.error('Failed to initialize Ton chain adapter:', error);
      throw error;
    }
  }

  private initializeTonAdapter(chainAdapterManager: Map<string, any>) {
    if (!process.env.VITE_TON_NODE_URL) {
      throw new Error('VITE_TON_NODE_URL required');
    }

    const tonAdapter = new ton.ChainAdapter({
      rpcUrl: process.env.VITE_TON_NODE_URL,
    });

    chainAdapterManager.set(tonChainId, tonAdapter);
    this.logger.log('Ton chain adapter initialized');
  }

  assertGetTonChainAdapter(chainId: ChainId): ton.ChainAdapter {
    if (chainId !== tonChainId) {
      throw new Error(`Chain ${chainId} is not Ton`);
    }

    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();

    const adapter = chainAdapterManager.get(chainId);
    if (!adapter) {
      throw new Error(`Ton chain adapter not found for chain ${chainId}`);
    }

    return adapter as ton.ChainAdapter;
  }
}
