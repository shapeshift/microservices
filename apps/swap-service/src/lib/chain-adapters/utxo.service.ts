import { Injectable, Logger } from '@nestjs/common';
import { ChainAdapterManagerService } from '../chain-adapter-manager.service';
import * as unchained from '@shapeshiftoss/unchained-client';
import { bitcoin } from '@shapeshiftoss/chain-adapters';
import { 
  btcChainId,
  bchChainId,
  dogeChainId,
  ltcChainId,
} from '@shapeshiftoss/caip';
import { utxoChainIds, type UtxoChainAdapter } from '@shapeshiftoss/chain-adapters';
import type { ChainId } from '@shapeshiftoss/caip';
import { UtxoChainId } from '@shapeshiftoss/types';

@Injectable()
export class UtxoChainAdapterService {
  private readonly logger = new Logger(UtxoChainAdapterService.name);

  constructor(private chainAdapterManagerService: ChainAdapterManagerService) {}

  async initializeUtxoChainAdapters() {
    this.logger.log('Initializing UTXO chain adapters...');
    
    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();

    try {
      await this.initializeBitcoinAdapter(chainAdapterManager);
      await this.initializeBitcoinCashAdapter(chainAdapterManager);
      await this.initializeDogecoinAdapter(chainAdapterManager);
      await this.initializeLitecoinAdapter(chainAdapterManager);

      this.logger.log('All UTXO chain adapters initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize UTXO chain adapters:', error);
      throw error;
    }
  }

  private async initializeBitcoinAdapter(chainAdapterManager: Map<string, any>) {
    const bitcoinHttp = new unchained.bitcoin.V1Api(
      new unchained.bitcoin.Configuration({
        basePath: process.env.VITE_UNCHAINED_BITCOIN_HTTP_URL,
      }),
    );

    const bitcoinWs = new unchained.ws.Client<unchained.bitcoin.Tx>(
      process.env.VITE_UNCHAINED_BITCOIN_WS_URL,
    );

    const bitcoinAdapter = new bitcoin.ChainAdapter({
      providers: { http: bitcoinHttp, ws: bitcoinWs },
      coinName: 'Bitcoin',
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(btcChainId, bitcoinAdapter);
    this.logger.log('Bitcoin adapter initialized');
  }

  private async initializeBitcoinCashAdapter(chainAdapterManager: Map<string, any>) {
    const bchHttp = new unchained.bitcoin.V1Api(
      new unchained.bitcoin.Configuration({
        basePath: process.env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL,
      }),
    );

    const bchWs = new unchained.ws.Client<unchained.bitcoin.Tx>(
      process.env.VITE_UNCHAINED_BITCOINCASH_WS_URL,
    );

    const bchAdapter = new bitcoin.ChainAdapter({
      providers: { http: bchHttp, ws: bchWs },
      coinName: 'BitcoinCash',
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(bchChainId, bchAdapter);
    this.logger.log('Bitcoin Cash adapter initialized');
  }

  private async initializeDogecoinAdapter(chainAdapterManager: Map<string, any>) {
    const dogeHttp = new unchained.bitcoin.V1Api(
      new unchained.bitcoin.Configuration({
        basePath: process.env.VITE_UNCHAINED_DOGECOIN_HTTP_URL,
      }),
    );

    const dogeWs = new unchained.ws.Client<unchained.bitcoin.Tx>(
      process.env.VITE_UNCHAINED_DOGECOIN_WS_URL,
    );

    const dogeAdapter = new bitcoin.ChainAdapter({
      providers: { http: dogeHttp, ws: dogeWs },
      coinName: 'Dogecoin',
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(dogeChainId, dogeAdapter);
    this.logger.log('Dogecoin adapter initialized');
  }

  private async initializeLitecoinAdapter(chainAdapterManager: Map<string, any>) {
    const ltcHttp = new unchained.bitcoin.V1Api(
      new unchained.bitcoin.Configuration({
        basePath: process.env.VITE_UNCHAINED_LITECOIN_HTTP_URL,
      }),
    );

    const ltcWs = new unchained.ws.Client<unchained.bitcoin.Tx>(
      process.env.VITE_UNCHAINED_LITECOIN_WS_URL,
    );

    const ltcAdapter = new bitcoin.ChainAdapter({
      providers: { http: ltcHttp, ws: ltcWs },
      coinName: 'Litecoin',
      thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
      mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
    });

    chainAdapterManager.set(ltcChainId, ltcAdapter);
    this.logger.log('Litecoin adapter initialized');
  }

  assertGetUtxoChainAdapter(chainId: ChainId): UtxoChainAdapter {
    if (!utxoChainIds.includes(chainId as UtxoChainId)) {
      throw new Error(`Chain ${chainId} is not a UTXO chain`);
    }

    const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
    const adapter = chainAdapterManager.get(chainId);

    if (!adapter) {
      throw new Error(`UTXO chain adapter not found for chain ${chainId}`);
    }

    return adapter as UtxoChainAdapter;
  }
}
