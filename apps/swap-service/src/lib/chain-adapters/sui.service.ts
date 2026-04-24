import { Injectable, Logger } from '@nestjs/common'

import type { ChainId } from '@shapeshiftoss/caip'
import { suiChainId } from '@shapeshiftoss/caip'
import { sui } from '@shapeshiftoss/chain-adapters'

import { env } from '../../env'
import { ChainAdapterManagerService } from '../chain-adapter-manager.service'

@Injectable()
export class SuiChainAdapterService {
  private readonly logger = new Logger(SuiChainAdapterService.name)

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  initializeSuiChainAdapter() {
    this.logger.log('Initializing Sui chain adapter...')

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    try {
      this.initializeSuiAdapter(chainAdapterManager)
    } catch (error) {
      this.logger.error('Failed to initialize Sui chain adapter:', error)
      throw error
    }
  }

  private initializeSuiAdapter(chainAdapterManager: Map<string, any>) {
    const suiAdapter = new sui.ChainAdapter({ rpcUrl: env.VITE_SUI_NODE_URL })

    chainAdapterManager.set(suiChainId, suiAdapter)
    this.logger.log('Sui chain adapter initialized')
  }

  assertGetSuiChainAdapter(chainId: ChainId): sui.ChainAdapter {
    if (chainId !== suiChainId) throw new Error(`Chain ${chainId} is not Sui`)

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager()

    const adapter = chainAdapterManager.get(chainId)
    if (!adapter) throw new Error(`Sui chain adapter not found for chain ${chainId}`)

    return adapter as sui.ChainAdapter
  }
}
