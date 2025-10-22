import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import * as unchained from '@shapeshiftoss/unchained-client';
import { cosmos, thorchain, mayachain } from '@shapeshiftoss/chain-adapters';
import { 
  cosmosChainId,
  thorchainChainId,
  mayachainChainId,
} from '@shapeshiftoss/caip';
import { cosmosSdkChainIds, type CosmosSdkChainAdapter } from '@shapeshiftoss/chain-adapters';
import type { ChainId } from '@shapeshiftoss/caip';
import { CosmosSdkChainId } from '@shapeshiftoss/types';

@Injectable()
export class CosmosSdkChainAdapterService {
  private readonly logger = new Logger(CosmosSdkChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  async initializeCosmosSdkChainAdapters() {
    this.logger.log('Initializing Cosmos SDK chain adapters...');
    
    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();

    try {
      await this.initializeCosmosAdapter(chainAdapterManager);
      await this.initializeThorchainAdapter(chainAdapterManager);
      await this.initializeMayachainAdapter(chainAdapterManager);

      this.logger.log('All Cosmos SDK chain adapters initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Cosmos SDK chain adapters:', error);
      throw error;
    }
  }

  private async initializeCosmosAdapter(chainAdapterManager: Map<string, any>) {
    const cosmosHttp = new unchained.cosmos.V1Api(
      new unchained.cosmos.Configuration({
        basePath: process.env.VITE_UNCHAINED_COSMOS_HTTP_URL,
      }),
    );

    const cosmosWs = new unchained.ws.Client<unchained.cosmos.Tx>(
      process.env.VITE_UNCHAINED_COSMOS_WS_URL,
    );

    const cosmosAdapter = new cosmos.ChainAdapter({
      providers: { http: cosmosHttp, ws: cosmosWs },
      midgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      coinName: 'Cosmos',
    });

    chainAdapterManager.set(cosmosChainId, cosmosAdapter);
    this.logger.log('Cosmos adapter initialized');
  }

  private async initializeThorchainAdapter(chainAdapterManager: Map<string, any>) {
    const http = new unchained.thorchain.V1Api(
      new unchained.thorchain.Configuration({
        basePath:  process.env.VITE_UNCHAINED_THORCHAIN_HTTP_URL,
      }),
    )

    const httpV1 = new unchained.thorchainV1.V1Api(
      new unchained.thorchainV1.Configuration({
        basePath: process.env.VITE_UNCHAINED_THORCHAIN_V1_HTTP_URL,
      }),
    )

    const ws = new unchained.ws.Client<unchained.cosmossdk.Tx>(
      process.env.VITE_UNCHAINED_THORCHAIN_WS_URL,
    )

    const thorchainAdapter = new thorchain.ChainAdapter({
      providers: { http, ws },
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
      coinName: 'THOR',
      httpV1,
    });

    chainAdapterManager.set(thorchainChainId, thorchainAdapter);
    this.logger.log('Thorchain adapter initialized');
  }

  private async initializeMayachainAdapter(chainAdapterManager: Map<string, any>) {
    const mayachainHttp = new unchained.mayachain.V1Api(
      new unchained.mayachain.Configuration({
        basePath: process.env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL,
      }),
    );

    const mayachainWs = new unchained.ws.Client<unchained.cosmos.Tx>(
      process.env.VITE_UNCHAINED_MAYACHAIN_WS_URL,
    );

    const mayachainAdapter = new mayachain.ChainAdapter({
      providers: { http: mayachainHttp, ws: mayachainWs },
      midgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
      coinName: 'MAYA',
    });

    chainAdapterManager.set(mayachainChainId, mayachainAdapter);
    this.logger.log('Mayachain adapter initialized');
  }

  assertGetCosmosSdkChainAdapter(chainId: ChainId): CosmosSdkChainAdapter {
    if (!cosmosSdkChainIds.includes(chainId as CosmosSdkChainId)) {
      throw new Error(`Chain ${chainId} is not a Cosmos SDK chain`);
    }

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!adapter) {
      throw new Error(`Cosmos SDK chain adapter not found for chain ${chainId}`);
    }

    return adapter as CosmosSdkChainAdapter;
  }
}
