import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import * as unchained from '@shapeshiftoss/unchained-client';
import { solana } from '@shapeshiftoss/chain-adapters';
import { solanaChainId } from '@shapeshiftoss/caip';
import type { ChainId } from '@shapeshiftoss/caip';

@Injectable()
export class SolanaChainAdapterService {
  private readonly logger = new Logger(SolanaChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  async initializeSolanaChainAdapter() {
    this.logger.log('Initializing Solana chain adapter...');
    
    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();

    try {
      await this.initializeSolanaAdapter(chainAdapterManager);
      this.logger.log('Solana chain adapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Solana chain adapter:', error);
      throw error;
    }
  }

  private async initializeSolanaAdapter(chainAdapterManager: Map<string, any>) {
    const solanaHttp = new unchained.solana.V1Api(
      new unchained.solana.Configuration({
        basePath: process.env.VITE_UNCHAINED_SOLANA_HTTP_URL,
      }),
    );

    const solanaWs = new unchained.ws.Client<unchained.solana.Tx>(
      process.env.VITE_UNCHAINED_SOLANA_WS_URL,
    );

    const solanaAdapter = new solana.ChainAdapter({
      providers: { http: solanaHttp, ws: solanaWs },
      rpcUrl: process.env.VITE_SOLANA_NODE_URL,
    });

    chainAdapterManager.set(solanaChainId, solanaAdapter);
    this.logger.log('Solana adapter initialized');
  }

  assertGetSolanaChainAdapter(chainId: ChainId): solana.ChainAdapter {
    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!adapter) {
      throw new Error(`Solana chain adapter not found for chain ${chainId}`);
    }

    return adapter as solana.ChainAdapter;
  }
}
