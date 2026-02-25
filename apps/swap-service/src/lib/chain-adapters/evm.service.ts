import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import * as unchained from '@shapeshiftoss/unchained-client';
import {
  ethereum,
  monad,
  hyperevm,
  ink,
  plasma,
  mantle,
  megaeth,
  berachain,
  cronos,
  katana,
  flowEvm,
  celo,
  plume,
  story,
  zksyncera,
  blast,
  worldchain,
  hemi,
  linea,
  scroll,
  sonic,
  unichain,
  bob,
  mode,
  soneium,
} from '@shapeshiftoss/chain-adapters';
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
  monadChainId,
  hyperEvmChainId,
  plasmaChainId,
  katanaChainId,
} from '@shapeshiftoss/caip';
import {
  evmChainIds,
  type EvmChainAdapter,
} from '@shapeshiftoss/chain-adapters';
import type { ChainId } from '@shapeshiftoss/caip';
import { EvmChainId, KnownChainIds } from '@shapeshiftoss/types';

@Injectable()
export class EvmChainAdapterService {
  private readonly logger = new Logger(EvmChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeEvmChainAdapters() {
    this.logger.log('Initializing EVM chain adapters...');

    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();

    try {
      this.initializeEthereumAdapter(chainAdapterManager);

      this.initializeAvalancheAdapter(chainAdapterManager);

      this.initializeOptimismAdapter(chainAdapterManager);

      this.initializeBscAdapter(chainAdapterManager);

      this.initializePolygonAdapter(chainAdapterManager);

      this.initializeGnosisAdapter(chainAdapterManager);

      this.initializeArbitrumAdapter(chainAdapterManager);

      this.initializeArbitrumNovaAdapter(chainAdapterManager);

      this.initializeBaseAdapter(chainAdapterManager);

      this.initializeMonadAdapter(chainAdapterManager);

      this.initializeHyperEvmAdapter(chainAdapterManager);

      this.initializeInkAdapter(chainAdapterManager);

      this.initializePlasmaAdapter(chainAdapterManager);

      this.initializeMantleAdapter(chainAdapterManager);

      this.initializeMegaEthAdapter(chainAdapterManager);

      this.initializeBerachainAdapter(chainAdapterManager);

      this.initializeCronosAdapter(chainAdapterManager);

      this.initializeKatanaAdapter(chainAdapterManager);

      this.initializeFlowEvmAdapter(chainAdapterManager);

      this.initializeCeloAdapter(chainAdapterManager);

      this.initializePlumeAdapter(chainAdapterManager);

      this.initializeStoryAdapter(chainAdapterManager);

      this.initializeZkSyncEraAdapter(chainAdapterManager);

      this.initializeBlastAdapter(chainAdapterManager);

      this.initializeWorldChainAdapter(chainAdapterManager);

      this.initializeHemiAdapter(chainAdapterManager);

      this.initializeLineaAdapter(chainAdapterManager);

      this.initializeScrollAdapter(chainAdapterManager);

      this.initializeSonicAdapter(chainAdapterManager);

      this.initializeUnichainAdapter(chainAdapterManager);

      this.initializeBobAdapter(chainAdapterManager);

      this.initializeModeAdapter(chainAdapterManager);

      this.initializeSoneiumAdapter(chainAdapterManager);

      this.logger.log('All EVM chain adapters initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize EVM chain adapters:', error);
      throw error;
    }
  }

  private initializeEthereumAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeAvalancheAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeOptimismAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeBscAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializePolygonAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeGnosisAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeArbitrumAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeArbitrumNovaAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeBaseAdapter(chainAdapterManager: Map<string, any>) {
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

  private initializeMonadAdapter(chainAdapterManager: Map<string, any>) {
    const monadAdapter = new monad.ChainAdapter({
      rpcUrl: process.env.VITE_MONAD_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(monadChainId, monadAdapter);
    this.logger.log('Monad adapter initialized');
  }

  private initializeHyperEvmAdapter(chainAdapterManager: Map<string, any>) {
    const hyperEvmAdapter = new hyperevm.ChainAdapter({
      rpcUrl: process.env.VITE_HYPEREVM_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(hyperEvmChainId, hyperEvmAdapter);
    this.logger.log('HyperEVM adapter initialized');
  }

  private initializeInkAdapter(chainAdapterManager: Map<string, any>) {
    const inkAdapter = new ink.ChainAdapter({
      rpcUrl: process.env.VITE_INK_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.InkMainnet, inkAdapter);
    this.logger.log('Ink adapter initialized');
  }

  private initializePlasmaAdapter(chainAdapterManager: Map<string, any>) {
    const plasmaAdapter = new plasma.ChainAdapter({
      rpcUrl: process.env.VITE_PLASMA_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(plasmaChainId, plasmaAdapter);
    this.logger.log('Plasma adapter initialized');
  }

  private initializeMantleAdapter(chainAdapterManager: Map<string, any>) {
    const mantleAdapter = new mantle.ChainAdapter({
      rpcUrl: process.env.VITE_MANTLE_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.MantleMainnet, mantleAdapter);
    this.logger.log('Mantle adapter initialized');
  }

  private initializeMegaEthAdapter(chainAdapterManager: Map<string, any>) {
    const megaEthAdapter = new megaeth.ChainAdapter({
      rpcUrl: process.env.VITE_MEGAETH_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.MegaEthMainnet, megaEthAdapter);
    this.logger.log('MegaETH adapter initialized');
  }

  private initializeBerachainAdapter(chainAdapterManager: Map<string, any>) {
    const berachainAdapter = new berachain.ChainAdapter({
      rpcUrl: process.env.VITE_BERACHAIN_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.BerachainMainnet, berachainAdapter);
    this.logger.log('Berachain adapter initialized');
  }

  private initializeCronosAdapter(chainAdapterManager: Map<string, any>) {
    const cronosAdapter = new cronos.ChainAdapter({
      rpcUrl: process.env.VITE_CRONOS_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.CronosMainnet, cronosAdapter);
    this.logger.log('Cronos adapter initialized');
  }

  private initializeKatanaAdapter(chainAdapterManager: Map<string, any>) {
    const katanaAdapter = new katana.ChainAdapter({
      rpcUrl: process.env.VITE_KATANA_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(katanaChainId, katanaAdapter);
    this.logger.log('Katana adapter initialized');
  }

  private initializeFlowEvmAdapter(chainAdapterManager: Map<string, any>) {
    const flowEvmAdapter = new flowEvm.ChainAdapter({
      rpcUrl: process.env.VITE_FLOWEVM_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.FlowEvmMainnet, flowEvmAdapter);
    this.logger.log('Flow EVM adapter initialized');
  }

  private initializeCeloAdapter(chainAdapterManager: Map<string, any>) {
    const celoAdapter = new celo.ChainAdapter({
      rpcUrl: process.env.VITE_CELO_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.CeloMainnet, celoAdapter);
    this.logger.log('Celo adapter initialized');
  }

  private initializePlumeAdapter(chainAdapterManager: Map<string, any>) {
    const plumeAdapter = new plume.ChainAdapter({
      rpcUrl: process.env.VITE_PLUME_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.PlumeMainnet, plumeAdapter);
    this.logger.log('Plume adapter initialized');
  }

  private initializeStoryAdapter(chainAdapterManager: Map<string, any>) {
    const storyAdapter = new story.ChainAdapter({
      rpcUrl: process.env.VITE_STORY_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.StoryMainnet, storyAdapter);
    this.logger.log('Story adapter initialized');
  }

  private initializeZkSyncEraAdapter(chainAdapterManager: Map<string, any>) {
    const zkSyncEraAdapter = new zksyncera.ChainAdapter({
      rpcUrl: process.env.VITE_ZKSYNCERA_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.ZkSyncEraMainnet, zkSyncEraAdapter);
    this.logger.log('zkSync Era adapter initialized');
  }

  private initializeBlastAdapter(chainAdapterManager: Map<string, any>) {
    const blastAdapter = new blast.ChainAdapter({
      rpcUrl: process.env.VITE_BLAST_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.BlastMainnet, blastAdapter);
    this.logger.log('Blast adapter initialized');
  }

  private initializeWorldChainAdapter(chainAdapterManager: Map<string, any>) {
    const worldChainAdapter = new worldchain.ChainAdapter({
      rpcUrl: process.env.VITE_WORLDCHAIN_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.WorldChainMainnet, worldChainAdapter);
    this.logger.log('World Chain adapter initialized');
  }

  private initializeHemiAdapter(chainAdapterManager: Map<string, any>) {
    const hemiAdapter = new hemi.ChainAdapter({
      rpcUrl: process.env.VITE_HEMI_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.HemiMainnet, hemiAdapter);
    this.logger.log('Hemi adapter initialized');
  }

  private initializeLineaAdapter(chainAdapterManager: Map<string, any>) {
    const lineaAdapter = new linea.ChainAdapter({
      rpcUrl: process.env.VITE_LINEA_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.LineaMainnet, lineaAdapter);
    this.logger.log('Linea adapter initialized');
  }

  private initializeScrollAdapter(chainAdapterManager: Map<string, any>) {
    const scrollAdapter = new scroll.ChainAdapter({
      rpcUrl: process.env.VITE_SCROLL_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.ScrollMainnet, scrollAdapter);
    this.logger.log('Scroll adapter initialized');
  }

  private initializeSonicAdapter(chainAdapterManager: Map<string, any>) {
    const sonicAdapter = new sonic.ChainAdapter({
      rpcUrl: process.env.VITE_SONIC_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.SonicMainnet, sonicAdapter);
    this.logger.log('Sonic adapter initialized');
  }

  private initializeUnichainAdapter(chainAdapterManager: Map<string, any>) {
    const unichainAdapter = new unichain.ChainAdapter({
      rpcUrl: process.env.VITE_UNICHAIN_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.UnichainMainnet, unichainAdapter);
    this.logger.log('Unichain adapter initialized');
  }

  private initializeBobAdapter(chainAdapterManager: Map<string, any>) {
    const bobAdapter = new bob.ChainAdapter({
      rpcUrl: process.env.VITE_BOB_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.BobMainnet, bobAdapter);
    this.logger.log('BOB adapter initialized');
  }

  private initializeModeAdapter(chainAdapterManager: Map<string, any>) {
    const modeAdapter = new mode.ChainAdapter({
      rpcUrl: process.env.VITE_MODE_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.ModeMainnet, modeAdapter);
    this.logger.log('Mode adapter initialized');
  }

  private initializeSoneiumAdapter(chainAdapterManager: Map<string, any>) {
    const soneiumAdapter = new soneium.ChainAdapter({
      rpcUrl: process.env.VITE_SONEIUM_NODE_URL || '',
      getKnownTokens: () => [],
    });
    chainAdapterManager.set(KnownChainIds.SoneiumMainnet, soneiumAdapter);
    this.logger.log('Soneium adapter initialized');
  }

  isEvmChainAdapter(chainAdapter: unknown): chainAdapter is EvmChainAdapter {
    return evmChainIds.includes(
      (chainAdapter as EvmChainAdapter).getChainId() as EvmChainId,
    );
  }

  assertGetEvmChainAdapter(chainId: ChainId): EvmChainAdapter {
    const chainAdapterManager =
      this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!this.isEvmChainAdapter(adapter)) {
      throw Error('invalid chain adapter');
    }

    return adapter;
  }
}
