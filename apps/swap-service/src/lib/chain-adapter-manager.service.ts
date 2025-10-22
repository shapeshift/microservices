import { Injectable } from '@nestjs/common';
import type { ChainAdapterManager } from '@shapeshiftoss/chain-adapters';

@Injectable()
export class ChainAdapterManagerService {
  private chainAdapterManager: ChainAdapterManager = new Map();

  getChainAdapterManager(): ChainAdapterManager {
    return this.chainAdapterManager;
  }

  setChainAdapterManager(manager: ChainAdapterManager): void {
    this.chainAdapterManager = manager;
  }
}
