import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import * as caip from '@shapeshiftoss/caip'
import type { EvmChainAdapter } from '@shapeshiftoss/chain-adapters'
import * as adapters from '@shapeshiftoss/chain-adapters'
import { EvmChainId, KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../../env'
import { ChainAdapterManagerService } from '../chain-adapter-manager.service'

@Injectable()
export class EvmChainAdapterService {
  private readonly logger = new Logger(EvmChainAdapterService.name)

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeEvmChainAdapters() {
    this.logger.log('Initializing EVM chain adapters...')

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    try {
      this.initializeEthereumAdapter(chainAdapterManager)
      this.initializeAvalancheAdapter(chainAdapterManager)
      this.initializeOptimismAdapter(chainAdapterManager)
      this.initializeBscAdapter(chainAdapterManager)
      this.initializePolygonAdapter(chainAdapterManager)
      this.initializeGnosisAdapter(chainAdapterManager)
      this.initializeArbitrumAdapter(chainAdapterManager)
      this.initializeBaseAdapter(chainAdapterManager)
      this.initializeMonadAdapter(chainAdapterManager)
      this.initializeHyperEvmAdapter(chainAdapterManager)
      this.initializeInkAdapter(chainAdapterManager)
      this.initializePlasmaAdapter(chainAdapterManager)
      this.initializeMantleAdapter(chainAdapterManager)
      this.initializeMegaEthAdapter(chainAdapterManager)
      this.initializeBerachainAdapter(chainAdapterManager)
      this.initializeCronosAdapter(chainAdapterManager)
      this.initializeKatanaAdapter(chainAdapterManager)
      this.initializeFlowEvmAdapter(chainAdapterManager)
      this.initializeCeloAdapter(chainAdapterManager)
      this.initializePlumeAdapter(chainAdapterManager)
      this.initializeStoryAdapter(chainAdapterManager)
      this.initializeZkSyncEraAdapter(chainAdapterManager)
      this.initializeBlastAdapter(chainAdapterManager)
      this.initializeWorldChainAdapter(chainAdapterManager)
      this.initializeHemiAdapter(chainAdapterManager)
      this.initializeLineaAdapter(chainAdapterManager)
      this.initializeScrollAdapter(chainAdapterManager)
      this.initializeSonicAdapter(chainAdapterManager)
      this.initializeUnichainAdapter(chainAdapterManager)
      this.initializeBobAdapter(chainAdapterManager)
      this.initializeModeAdapter(chainAdapterManager)
      this.initializeSoneiumAdapter(chainAdapterManager)

      this.logger.log('All EVM chain adapters initialized successfully')
    } catch (error) {
      this.logger.error('Failed to initialize EVM chain adapters:', error)
      throw error
    }
  }

  private initializeEthereumAdapter(chainAdapterManager: Map<string, any>) {
    const ethereumHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_ETHEREUM_HTTP_URL }),
    )

    const ethereumWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_ETHEREUM_WS_URL)

    const ethereumAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: ethereumHttp, ws: ethereumWs },
      rpcUrl: env.VITE_ETHEREUM_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.ethChainId, ethereumAdapter)
    this.logger.log('Ethereum chain adapter initialized')
  }

  private initializeAvalancheAdapter(chainAdapterManager: Map<string, any>) {
    const avalancheHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_AVALANCHE_HTTP_URL }),
    )

    const avalancheWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_AVALANCHE_WS_URL)

    const avalancheAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: avalancheHttp, ws: avalancheWs },
      rpcUrl: env.VITE_AVALANCHE_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.avalancheChainId, avalancheAdapter)
    this.logger.log('Avalanche chain adapter initialized')
  }

  private initializeOptimismAdapter(chainAdapterManager: Map<string, any>) {
    const optimismHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_OPTIMISM_HTTP_URL }),
    )

    const optimismWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_OPTIMISM_WS_URL)

    const optimismAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: optimismHttp, ws: optimismWs },
      rpcUrl: env.VITE_OPTIMISM_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.optimismChainId, optimismAdapter)
    this.logger.log('Optimism chain adapter initialized')
  }

  private initializeBscAdapter(chainAdapterManager: Map<string, any>) {
    const bscHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL }),
    )

    const bscWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_BNBSMARTCHAIN_WS_URL)

    const bscAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: bscHttp, ws: bscWs },
      rpcUrl: env.VITE_BNBSMARTCHAIN_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.bscChainId, bscAdapter)
    this.logger.log('BNB Smart Chain chain adapter initialized')
  }

  private initializePolygonAdapter(chainAdapterManager: Map<string, any>) {
    const polygonHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_POLYGON_HTTP_URL }),
    )

    const polygonWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_POLYGON_WS_URL)

    const polygonAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: polygonHttp, ws: polygonWs },
      rpcUrl: env.VITE_POLYGON_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.polygonChainId, polygonAdapter)
    this.logger.log('Polygon chain adapter initialized')
  }

  private initializeGnosisAdapter(chainAdapterManager: Map<string, any>) {
    const gnosisHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_GNOSIS_HTTP_URL }),
    )

    const gnosisWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_GNOSIS_WS_URL)

    const gnosisAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: gnosisHttp, ws: gnosisWs },
      rpcUrl: env.VITE_GNOSIS_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.gnosisChainId, gnosisAdapter)
    this.logger.log('Gnosis chain adapter initialized')
  }

  private initializeArbitrumAdapter(chainAdapterManager: Map<string, any>) {
    const arbitrumHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_ARBITRUM_HTTP_URL }),
    )

    const arbitrumWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_ARBITRUM_WS_URL)

    const arbitrumAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: arbitrumHttp, ws: arbitrumWs },
      rpcUrl: env.VITE_ARBITRUM_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.arbitrumChainId, arbitrumAdapter)
    this.logger.log('Arbitrum chain adapter initialized')
  }

  private initializeBaseAdapter(chainAdapterManager: Map<string, any>) {
    const baseHttp = new unchained.ethereum.V1Api(
      new unchained.ethereum.Configuration({ basePath: env.VITE_UNCHAINED_BASE_HTTP_URL }),
    )

    const baseWs = new unchained.ws.Client<unchained.ethereum.Tx>(env.VITE_UNCHAINED_BASE_WS_URL)

    const baseAdapter = new adapters.ethereum.ChainAdapter({
      providers: { http: baseHttp, ws: baseWs },
      rpcUrl: env.VITE_BASE_NODE_URL,
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.baseChainId, baseAdapter)
    this.logger.log('Base chain adapter initialized')
  }

  private initializeMonadAdapter(chainAdapterManager: Map<string, any>) {
    const monadAdapter = new adapters.monad.ChainAdapter({
      rpcUrl: env.VITE_MONAD_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(caip.monadChainId, monadAdapter)
    this.logger.log('Monad chain adapter initialized')
  }

  private initializeHyperEvmAdapter(chainAdapterManager: Map<string, any>) {
    const hyperEvmAdapter = new adapters.hyperevm.ChainAdapter({
      rpcUrl: env.VITE_HYPEREVM_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(caip.hyperEvmChainId, hyperEvmAdapter)
    this.logger.log('HyperEVM chain adapter initialized')
  }

  private initializeInkAdapter(chainAdapterManager: Map<string, any>) {
    const inkAdapter = new adapters.ink.ChainAdapter({
      rpcUrl: env.VITE_INK_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.InkMainnet, inkAdapter)
    this.logger.log('Ink chain adapter initialized')
  }

  private initializePlasmaAdapter(chainAdapterManager: Map<string, any>) {
    const plasmaAdapter = new adapters.plasma.ChainAdapter({
      rpcUrl: env.VITE_PLASMA_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(caip.plasmaChainId, plasmaAdapter)
    this.logger.log('Plasma chain adapter initialized')
  }

  private initializeMantleAdapter(chainAdapterManager: Map<string, any>) {
    const mantleAdapter = new adapters.mantle.ChainAdapter({
      rpcUrl: env.VITE_MANTLE_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.MantleMainnet, mantleAdapter)
    this.logger.log('Mantle chain adapter initialized')
  }

  private initializeMegaEthAdapter(chainAdapterManager: Map<string, any>) {
    const megaEthAdapter = new adapters.megaeth.ChainAdapter({
      rpcUrl: env.VITE_MEGAETH_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.MegaEthMainnet, megaEthAdapter)
    this.logger.log('MegaETH chain adapter initialized')
  }

  private initializeBerachainAdapter(chainAdapterManager: Map<string, any>) {
    const berachainAdapter = new adapters.berachain.ChainAdapter({
      rpcUrl: env.VITE_BERACHAIN_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.BerachainMainnet, berachainAdapter)
    this.logger.log('Berachain chain adapter initialized')
  }

  private initializeCronosAdapter(chainAdapterManager: Map<string, any>) {
    const cronosAdapter = new adapters.cronos.ChainAdapter({
      rpcUrl: env.VITE_CRONOS_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.CronosMainnet, cronosAdapter)
    this.logger.log('Cronos chain adapter initialized')
  }

  private initializeKatanaAdapter(chainAdapterManager: Map<string, any>) {
    const katanaAdapter = new adapters.katana.ChainAdapter({
      rpcUrl: env.VITE_KATANA_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(caip.katanaChainId, katanaAdapter)
    this.logger.log('Katana chain adapter initialized')
  }

  private initializeFlowEvmAdapter(chainAdapterManager: Map<string, any>) {
    const flowEvmAdapter = new adapters.flowEvm.ChainAdapter({
      rpcUrl: env.VITE_FLOWEVM_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.FlowEvmMainnet, flowEvmAdapter)
    this.logger.log('Flow EVM chain adapter initialized')
  }

  private initializeCeloAdapter(chainAdapterManager: Map<string, any>) {
    const celoAdapter = new adapters.celo.ChainAdapter({
      rpcUrl: env.VITE_CELO_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.CeloMainnet, celoAdapter)
    this.logger.log('Celo chain adapter initialized')
  }

  private initializePlumeAdapter(chainAdapterManager: Map<string, any>) {
    const plumeAdapter = new adapters.plume.ChainAdapter({
      rpcUrl: env.VITE_PLUME_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.PlumeMainnet, plumeAdapter)
    this.logger.log('Plume chain adapter initialized')
  }

  private initializeStoryAdapter(chainAdapterManager: Map<string, any>) {
    const storyAdapter = new adapters.story.ChainAdapter({
      rpcUrl: env.VITE_STORY_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.StoryMainnet, storyAdapter)
    this.logger.log('Story chain adapter initialized')
  }

  private initializeZkSyncEraAdapter(chainAdapterManager: Map<string, any>) {
    const zkSyncEraAdapter = new adapters.zksyncera.ChainAdapter({
      rpcUrl: env.VITE_ZKSYNCERA_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.ZkSyncEraMainnet, zkSyncEraAdapter)
    this.logger.log('zkSync Era chain adapter initialized')
  }

  private initializeBlastAdapter(chainAdapterManager: Map<string, any>) {
    const blastAdapter = new adapters.blast.ChainAdapter({
      rpcUrl: env.VITE_BLAST_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.BlastMainnet, blastAdapter)
    this.logger.log('Blast chain adapter initialized')
  }

  private initializeWorldChainAdapter(chainAdapterManager: Map<string, any>) {
    const worldChainAdapter = new adapters.worldchain.ChainAdapter({
      rpcUrl: env.VITE_WORLDCHAIN_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.WorldChainMainnet, worldChainAdapter)
    this.logger.log('World Chain chain adapter initialized')
  }

  private initializeHemiAdapter(chainAdapterManager: Map<string, any>) {
    const hemiAdapter = new adapters.hemi.ChainAdapter({
      rpcUrl: env.VITE_HEMI_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.HemiMainnet, hemiAdapter)
    this.logger.log('Hemi chain adapter initialized')
  }

  private initializeLineaAdapter(chainAdapterManager: Map<string, any>) {
    const lineaAdapter = new adapters.linea.ChainAdapter({
      rpcUrl: env.VITE_LINEA_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.LineaMainnet, lineaAdapter)
    this.logger.log('Linea chain adapter initialized')
  }

  private initializeScrollAdapter(chainAdapterManager: Map<string, any>) {
    const scrollAdapter = new adapters.scroll.ChainAdapter({
      rpcUrl: env.VITE_SCROLL_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.ScrollMainnet, scrollAdapter)
    this.logger.log('Scroll chain adapter initialized')
  }

  private initializeSonicAdapter(chainAdapterManager: Map<string, any>) {
    const sonicAdapter = new adapters.sonic.ChainAdapter({
      rpcUrl: env.VITE_SONIC_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.SonicMainnet, sonicAdapter)
    this.logger.log('Sonic chain adapter initialized')
  }

  private initializeUnichainAdapter(chainAdapterManager: Map<string, any>) {
    const unichainAdapter = new adapters.unichain.ChainAdapter({
      rpcUrl: env.VITE_UNICHAIN_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.UnichainMainnet, unichainAdapter)
    this.logger.log('Unichain chain adapter initialized')
  }

  private initializeBobAdapter(chainAdapterManager: Map<string, any>) {
    const bobAdapter = new adapters.bob.ChainAdapter({
      rpcUrl: env.VITE_BOB_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.BobMainnet, bobAdapter)
    this.logger.log('BOB chain adapter initialized')
  }

  private initializeModeAdapter(chainAdapterManager: Map<string, any>) {
    const modeAdapter = new adapters.mode.ChainAdapter({
      rpcUrl: env.VITE_MODE_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.ModeMainnet, modeAdapter)
    this.logger.log('Mode chain adapter initialized')
  }

  private initializeSoneiumAdapter(chainAdapterManager: Map<string, any>) {
    const soneiumAdapter = new adapters.soneium.ChainAdapter({
      rpcUrl: env.VITE_SONEIUM_NODE_URL,
      getKnownTokens: () => [],
    })

    chainAdapterManager.set(KnownChainIds.SoneiumMainnet, soneiumAdapter)
    this.logger.log('Soneium chain adapter initialized')
  }

  assertGetEvmChainAdapter(chainId: ChainId): EvmChainAdapter {
    if (!adapters.evmChainIds.includes(chainId as EvmChainId)) throw new Error(`Chain ${chainId} is not a EVM chain`)

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    const adapter = chainAdapterManager.get(chainId)
    if (!adapter) throw new Error(`EVM chain adapter not found for chain ${chainId}`)

    return adapter as EvmChainAdapter
  }
}
