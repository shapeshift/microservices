import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import { aptosChainId } from '@shapeshiftoss/caip'
import { aptos } from '@shapeshiftoss/chain-adapters'

import { env } from '../../env'
import { ChainAdapterManagerService } from '../chain-adapter-manager.service'

@Injectable()
export class AptosChainAdapterService {
  private readonly logger = new Logger(AptosChainAdapterService.name)

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeAptosChainAdapter() {
    this.logger.log('Initializing Aptos chain adapter...')

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    try {
      this.initializeAptosAdapter(chainAdapterManager)
    } catch (error) {
      this.logger.error('Failed to initialize Aptos chain adapter:', error)
      throw error
    }
  }

  private initializeAptosAdapter(chainAdapterManager: Map<string, any>) {
    const aptosAdapter = new aptos.ChainAdapter({
      rpcUrl: env.VITE_APTOS_NODE_URL,
      indexerUrl: env.VITE_APTOS_INDEXER_URL,
    })

    chainAdapterManager.set(aptosChainId, aptosAdapter)
    this.logger.log('Aptos chain adapter initialized')
  }

  assertGetAptosChainAdapter(chainId: ChainId): aptos.ChainAdapter {
    if (chainId !== aptosChainId) throw new Error(`Chain ${chainId} is not Aptos`)

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    const adapter = chainAdapterManager.get(chainId)
    if (!adapter) throw new Error(`Aptos chain adapter not found for chain ${chainId}`)

    return adapter as aptos.ChainAdapter
  }
}
