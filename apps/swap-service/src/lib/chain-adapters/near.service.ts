import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import { nearChainId } from '@shapeshiftoss/caip'
import { near } from '@shapeshiftoss/chain-adapters'

import { ChainAdapterManagerService } from '../chain-adapter-manager.service'

@Injectable()
export class NearChainAdapterService {
  private readonly logger = new Logger(NearChainAdapterService.name)

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeNearChainAdapter() {
    this.logger.log('Initializing Near chain adapter...')

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    try {
      this.initializeNearAdapter(chainAdapterManager)
    } catch (error) {
      this.logger.error('Failed to initialize Near chain adapter:', error)
      throw error
    }
  }

  private initializeNearAdapter(chainAdapterManager: Map<string, any>) {
    if (!process.env.VITE_NEAR_NODE_URLS) throw new Error('VITE_NEAR_NODE_URLS required')
    if (!process.env.VITE_NEAR_FAST_API_URL) throw new Error('VITE_NEAR_FAST_API_URL required')

    const nearAdapter = new near.ChainAdapter({
      rpcUrls: process.env.VITE_NEAR_NODE_URLS.split(',').filter(Boolean),
      fastNearApiUrl: process.env.VITE_NEAR_FAST_API_URL,
    })

    chainAdapterManager.set(nearChainId, nearAdapter)
    this.logger.log('Near chain adapter initialized')
  }

  assertGetNearChainAdapter(chainId: ChainId): near.ChainAdapter {
    if (chainId !== nearChainId) throw new Error(`Chain ${chainId} is not Near`)

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    const adapter = chainAdapterManager.get(chainId)
    if (!adapter) throw new Error(`Near chain adapter not found for chain ${chainId}`)

    return adapter as near.ChainAdapter
  }
}
