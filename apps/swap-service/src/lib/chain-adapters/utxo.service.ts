import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import * as caip from '@shapeshiftoss/caip'
import type { UtxoChainAdapter } from '@shapeshiftoss/chain-adapters'
import * as adapters from '@shapeshiftoss/chain-adapters'
import { UtxoChainId } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../../env'
import { ChainAdapterManagerService } from '../chain-adapter-manager.service'

@Injectable()
export class UtxoChainAdapterService {
  private readonly logger = new Logger(UtxoChainAdapterService.name)

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeUtxoChainAdapters() {
    this.logger.log('Initializing UTXO chain adapters...')

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    try {
      this.initializeBitcoinAdapter(chainAdapterManager)
      this.initializeBitcoinCashAdapter(chainAdapterManager)
      this.initializeDogecoinAdapter(chainAdapterManager)
      this.initializeLitecoinAdapter(chainAdapterManager)
      this.initializeZcashAdapter(chainAdapterManager)
    } catch (error) {
      this.logger.error('Failed to initialize UTXO chain adapters:', error)
      throw error
    }
  }

  private initializeBitcoinAdapter(chainAdapterManager: Map<string, any>) {
    const bitcoinHttp = new unchained.bitcoin.V1Api(
      new unchained.bitcoin.Configuration({ basePath: env.VITE_UNCHAINED_BITCOIN_HTTP_URL }),
    )

    const bitcoinWs = new unchained.ws.Client<unchained.bitcoin.Tx>(env.VITE_UNCHAINED_BITCOIN_WS_URL)

    const bitcoinAdapter = new adapters.bitcoin.ChainAdapter({
      providers: { http: bitcoinHttp, ws: bitcoinWs },
      coinName: 'Bitcoin',
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.btcChainId, bitcoinAdapter)
    this.logger.log('Bitcoin chain adapter initialized')
  }

  private initializeBitcoinCashAdapter(chainAdapterManager: Map<string, any>) {
    const bchHttp = new unchained.bitcoincash.V1Api(
      new unchained.bitcoincash.Configuration({ basePath: env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL }),
    )

    const bchWs = new unchained.ws.Client<unchained.bitcoincash.Tx>(env.VITE_UNCHAINED_BITCOINCASH_WS_URL)

    const bchAdapter = new adapters.bitcoincash.ChainAdapter({
      providers: { http: bchHttp, ws: bchWs },
      coinName: 'BitcoinCash',
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.bchChainId, bchAdapter)
    this.logger.log('BitcoinCash chain adapter initialized')
  }

  private initializeDogecoinAdapter(chainAdapterManager: Map<string, any>) {
    const dogeHttp = new unchained.dogecoin.V1Api(
      new unchained.dogecoin.Configuration({ basePath: env.VITE_UNCHAINED_DOGECOIN_HTTP_URL }),
    )

    const dogeWs = new unchained.ws.Client<unchained.dogecoin.Tx>(env.VITE_UNCHAINED_DOGECOIN_WS_URL)

    const dogeAdapter = new adapters.dogecoin.ChainAdapter({
      providers: { http: dogeHttp, ws: dogeWs },
      coinName: 'Dogecoin',
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.dogeChainId, dogeAdapter)
    this.logger.log('Dogecoin chain adapter initialized')
  }

  private initializeLitecoinAdapter(chainAdapterManager: Map<string, any>) {
    const ltcHttp = new unchained.litecoin.V1Api(
      new unchained.litecoin.Configuration({ basePath: env.VITE_UNCHAINED_LITECOIN_HTTP_URL }),
    )

    const ltcWs = new unchained.ws.Client<unchained.litecoin.Tx>(env.VITE_UNCHAINED_LITECOIN_WS_URL)

    const ltcAdapter = new adapters.litecoin.ChainAdapter({
      providers: { http: ltcHttp, ws: ltcWs },
      coinName: 'Litecoin',
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.ltcChainId, ltcAdapter)
    this.logger.log('Litecoin chain adapter initialized')
  }

  private initializeZcashAdapter(chainAdapterManager: Map<string, any>) {
    const zcashHttp = new unchained.zcash.V1Api(
      new unchained.zcash.Configuration({ basePath: env.VITE_UNCHAINED_ZCASH_HTTP_URL }),
    )

    const zcashWs = new unchained.ws.Client<unchained.zcash.Tx>(env.VITE_UNCHAINED_ZCASH_WS_URL)

    const zcashAdapter = new adapters.zcash.ChainAdapter({
      providers: { http: zcashHttp, ws: zcashWs },
      coinName: 'Zcash',
      thorMidgardUrl: env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL,
    })

    chainAdapterManager.set(caip.zecChainId, zcashAdapter)
    this.logger.log('Zcash chain adapter initialized')
  }

  assertGetUtxoChainAdapter(chainId: ChainId): UtxoChainAdapter {
    if (!adapters.utxoChainIds.includes(chainId as UtxoChainId)) throw new Error(`Chain ${chainId} is not a UTXO chain`)

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    const adapter = chainAdapterManager.get(chainId)
    if (!adapter) throw new Error(`UTXO chain adapter not found for chain ${chainId}`)

    return adapter as UtxoChainAdapter
  }
}
