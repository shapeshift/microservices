import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import { tronChainId } from '@shapeshiftoss/caip'
import { tron } from '@shapeshiftoss/chain-adapters'
import * as unchained from '@shapeshiftoss/unchained-client'

import { env } from '../../env'
import { ChainAdapterManagerService } from '../chain-adapter-manager.service'

@Injectable()
export class TronChainAdapterService {
  private readonly logger = new Logger(TronChainAdapterService.name)

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeTronChainAdapter() {
    this.logger.log('Initializing Tron chain adapter...')

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    try {
      this.initializeTronAdapter(chainAdapterManager)
    } catch (error) {
      this.logger.error('Failed to initialize Tron chain adapter:', error)
      throw error
    }
  }

  private initializeTronAdapter(chainAdapterManager: Map<string, any>) {
    const tronHttp = new unchained.tron.TronApi({ rpcUrl: env.VITE_TRON_NODE_URL })

    const tronAdapter = new tron.ChainAdapter({
      providers: { http: tronHttp },
      rpcUrl: env.VITE_TRON_NODE_URL,
    })

    chainAdapterManager.set(tronChainId, tronAdapter)
    this.logger.log('Tron chain adapter initialized')
  }

  assertGetTronChainAdapter(chainId: ChainId): tron.ChainAdapter {
    if (chainId !== tronChainId) throw new Error(`Chain ${chainId} is not Tron`)

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    const adapter = chainAdapterManager.get(chainId)
    if (!adapter) throw new Error(`Tron chain adapter not found for chain ${chainId}`)

    return adapter as tron.ChainAdapter
  }
}
