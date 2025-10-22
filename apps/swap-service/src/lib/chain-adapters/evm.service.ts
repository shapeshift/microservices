import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import * as unchained from '@shapeshiftoss/unchained-client';
import { ethereum } from '@shapeshiftoss/chain-adapters';
import { 
  ethChainId,
  avalancheChainId,
  optimismChainId,
  bscChainId,
  polygonChainId,
  gnosisChainId,
  arbitrumChainId,
  arbitrumNovaChainId,
  baseChainId,
} from '@shapeshiftoss/caip';
import { evmChainIds, type EvmChainAdapter } from '@shapeshiftoss/chain-adapters';
import type { ChainId } from '@shapeshiftoss/caip';
import { EvmChainId } from '@shapeshiftoss/types';

@Injectable()
export class EvmChainAdapterService {
  private readonly logger = new Logger(EvmChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  async initializeEvmChainAdapters() {
    this.logger.log('Initializing EVM chain adapters...');
    
    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();

    try {
      await this.initializeEthereumAdapter(chainAdapterManager);
      
      await this.initializeAvalancheAdapter(chainAdapterManager);
      
      await this.initializeOptimismAdapter(chainAdapterManager);
      
      await this.initializeBscAdapter(chainAdapterManager);
      
      await this.initializePolygonAdapter(chainAdapterManager);
      
      await this.initializeGnosisAdapter(chainAdapterManager);
      
      await this.initializeArbitrumAdapter(chainAdapterManager);
      
      await this.initializeArbitrumNovaAdapter(chainAdapterManager);
      
      await this.initializeBaseAdapter(chainAdapterManager);

      this.logger.log('All EVM chain adapters initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize EVM chain adapters:', error);
      throw error;
    }
  }

  private async initializeEthereumAdapter(chainAdapterManager: Map<string, any>) {
    const ethereumHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_ETHEREUM_HTTP_URL,
      }),
    );

    const ethereumWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_ETHEREUM_WS_URL,
    );

    const ethereumAdapter = new ethereum.ChainAdapter({
      providers: { http: ethereumHttp, ws: ethereumWs },
      rpcUrl: process.env.VITE_ETHEREUM_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(ethChainId, ethereumAdapter);
    this.logger.log('Ethereum adapter initialized');
  }

  private async initializeAvalancheAdapter(chainAdapterManager: Map<string, any>) {
    const avalancheHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_AVALANCHE_HTTP_URL,
      }),
    );

    const avalancheWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_AVALANCHE_WS_URL,
    );

    const avalancheAdapter = new ethereum.ChainAdapter({
      providers: { http: avalancheHttp, ws: avalancheWs },
      rpcUrl: process.env.VITE_AVALANCHE_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(avalancheChainId, avalancheAdapter);
    this.logger.log('Avalanche adapter initialized');
  }

  private async initializeOptimismAdapter(chainAdapterManager: Map<string, any>) {
    const optimismHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_OPTIMISM_HTTP_URL,
      }),
    );

    const optimismWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_OPTIMISM_WS_URL,
    );

    const optimismAdapter = new ethereum.ChainAdapter({
      providers: { http: optimismHttp, ws: optimismWs },
      rpcUrl: process.env.VITE_OPTIMISM_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(optimismChainId, optimismAdapter);
    this.logger.log('Optimism adapter initialized');
  }

  private async initializeBscAdapter(chainAdapterManager: Map<string, any>) {
    const bscHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL,
      }),
    );

    const bscWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_BNBSMARTCHAIN_WS_URL,
    );

    const bscAdapter = new ethereum.ChainAdapter({
      providers: { http: bscHttp, ws: bscWs },
      rpcUrl: process.env.VITE_BNBSMARTCHAIN_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(bscChainId, bscAdapter);
    this.logger.log('BNB Smart Chain adapter initialized');
  }

  private async initializePolygonAdapter(chainAdapterManager: Map<string, any>) {
    const polygonHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_POLYGON_HTTP_URL,
      }),
    );

    const polygonWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_POLYGON_WS_URL,
    );

    const polygonAdapter = new ethereum.ChainAdapter({
      providers: { http: polygonHttp, ws: polygonWs },
      rpcUrl: process.env.VITE_POLYGON_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(polygonChainId, polygonAdapter);
    this.logger.log('Polygon adapter initialized');
  }

  private async initializeGnosisAdapter(chainAdapterManager: Map<string, any>) {
    const gnosisHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_GNOSIS_HTTP_URL,
      }),
    );

    const gnosisWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_GNOSIS_WS_URL,
    );

    const gnosisAdapter = new ethereum.ChainAdapter({
      providers: { http: gnosisHttp, ws: gnosisWs },
      rpcUrl: process.env.VITE_GNOSIS_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(gnosisChainId, gnosisAdapter);
    this.logger.log('Gnosis adapter initialized');
  }

  private async initializeArbitrumAdapter(chainAdapterManager: Map<string, any>) {
    const arbitrumHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_ARBITRUM_HTTP_URL,
      }),
    );

    const arbitrumWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_ARBITRUM_WS_URL,
    );

    const arbitrumAdapter = new ethereum.ChainAdapter({
      providers: { http: arbitrumHttp, ws: arbitrumWs },
      rpcUrl: process.env.VITE_ARBITRUM_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(arbitrumChainId, arbitrumAdapter);
    this.logger.log('Arbitrum adapter initialized');
  }

  private async initializeArbitrumNovaAdapter(chainAdapterManager: Map<string, any>) {
    const arbitrumNovaHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_ARBITRUM_NOVA_HTTP_URL,
      }),
    );

    const arbitrumNovaWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_ARBITRUM_NOVA_WS_URL,
    );

    const arbitrumNovaAdapter = new ethereum.ChainAdapter({
      providers: { http: arbitrumNovaHttp, ws: arbitrumNovaWs },
      rpcUrl: process.env.VITE_ARBITRUM_NOVA_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(arbitrumNovaChainId, arbitrumNovaAdapter);
    this.logger.log('Arbitrum Nova adapter initialized');
  }

  private async initializeBaseAdapter(chainAdapterManager: Map<string, any>) {
    const baseHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({
        basePath: process.env.VITE_UNCHAINED_BASE_HTTP_URL,
      }),
    );

    const baseWs = new unchained.ws.Client<unchained.ethereum.Tx>(
      process.env.VITE_UNCHAINED_BASE_WS_URL,
    );

    const baseAdapter = new ethereum.ChainAdapter({
      providers: { http: baseHttp, ws: baseWs },
      rpcUrl: process.env.VITE_BASE_NODE_URL,
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(baseChainId, baseAdapter);
    this.logger.log('Base adapter initialized');
  }

  isEvmChainAdapter(chainAdapter: unknown): chainAdapter is EvmChainAdapter {
    return evmChainIds.includes((chainAdapter as EvmChainAdapter).getChainId() as EvmChainId);
  }

  assertGetEvmChainAdapter(chainId: ChainId): EvmChainAdapter {
    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!this.isEvmChainAdapter(adapter)) {
      throw Error('invalid chain adapter');
    }

    return adapter;
  }
}
