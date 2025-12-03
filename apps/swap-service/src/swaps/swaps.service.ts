import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Swap } from '@prisma/client';
import { EvmChainAdapterService } from '../lib/chain-adapters/evm.service';
import { UtxoChainAdapterService } from '../lib/chain-adapters/utxo.service';
import { CosmosSdkChainAdapterService } from '../lib/chain-adapters/cosmos-sdk.service';
import { SolanaChainAdapterService } from '../lib/chain-adapters/solana.service';
import { SwapperName, swappers, SwapSource, SwapStatus } from '@shapeshiftoss/swapper';
import { ChainId } from '@shapeshiftoss/caip';
import { Asset } from '@shapeshiftoss/types';
import { hashAccountId } from '@shapeshift/shared-utils';
import { NotificationsServiceClient } from '@shapeshift/shared-utils';
import { CreateSwapDto, SwapStatusResponse, UpdateSwapStatusDto } from '@shapeshift/shared-types';
import { bnOrZero } from '@shapeshiftoss/chain-adapters';

@Injectable()
export class SwapsService {
  private readonly logger = new Logger(SwapsService.name);
  private readonly notificationsClient: NotificationsServiceClient;

  constructor(
    private prisma: PrismaService,
    private evmChainAdapterService: EvmChainAdapterService,
    private utxoChainAdapterService: UtxoChainAdapterService,
    private cosmosSdkChainAdapterService: CosmosSdkChainAdapterService,
    private solanaChainAdapterService: SolanaChainAdapterService,
  ) {
    this.notificationsClient = new NotificationsServiceClient();
  }

  async createSwap(data: CreateSwapDto) {
    try {
      const swap = await this.prisma.swap.create({
        data: {
          swapId: data.swapId,
          sellAsset: data.sellAsset,
          buyAsset: data.buyAsset,
          sellTxHash: data.sellTxHash,
          sellAmountCryptoBaseUnit: data.sellAmountCryptoBaseUnit,
          expectedBuyAmountCryptoBaseUnit: data.expectedBuyAmountCryptoBaseUnit,
          sellAmountCryptoPrecision: data.sellAmountCryptoPrecision,
          expectedBuyAmountCryptoPrecision: data.expectedBuyAmountCryptoPrecision,
          source: data.source,
          swapperName: data.swapperName,
          sellAccountId: hashAccountId(data.sellAccountId),
          buyAccountId: data.buyAccountId ? hashAccountId(data.buyAccountId) : null,
          receiveAddress: data.receiveAddress,
          isStreaming: data.isStreaming || false,
          metadata: data.metadata || {},
          userId: data.userId,
        },
      });

      this.logger.log(`Swap created: ${swap.id}`);
      return swap;
    } catch (error) {
      this.logger.error('Failed to create swap', error);
      throw error;
    }
  }

  async updateSwapStatus(data: UpdateSwapStatusDto) {
    try {
      const swap = await this.prisma.swap.update({
        where: { swapId: data.swapId },
        data: {
          status: data.status,
          sellTxHash: data.sellTxHash,
          buyTxHash: data.buyTxHash,
          txLink: data.txLink,
          statusMessage: data.statusMessage,
          actualBuyAmountCryptoPrecision: data.actualBuyAmountCryptoPrecision,
        },
      });

      await this.sendStatusUpdateNotification(swap);

      this.logger.log(`Swap status updated: ${swap.swapId} -> ${data.status}`);
      return {
        ...swap,
        sellAsset: swap.sellAsset as Asset,
        buyAsset: swap.buyAsset as Asset,
      };
    } catch (error) {
      this.logger.error('Failed to update swap status', error);
      throw error;
    }
  }

  private formatAmount(amount: string | number): string {
    // Convert to number with up to 8 decimals, then remove trailing zeros
    const num = bnOrZero(amount).toFixed(8);
    // Remove trailing zeros and trailing decimal point
    return num.replace(/\.?0+$/, '');
  }

  private async sendStatusUpdateNotification(swap: Pick<Swap, 'id' | 'userId' | 'status' | 'sellAsset' | 'buyAsset' | 'sellAmountCryptoPrecision' | 'actualBuyAmountCryptoPrecision' | 'expectedBuyAmountCryptoPrecision'>) {
    let title: string;
    let body: string;
    let type: 'SWAP_STATUS_UPDATE' | 'SWAP_COMPLETED' | 'SWAP_FAILED';

    const sellAsset = swap.sellAsset as Asset;
    const buyAsset = swap.buyAsset as Asset;

    switch (swap.status) {
      case 'SUCCESS':
        title = 'Swap Completed!';
        const buyAmount = this.formatAmount(swap.actualBuyAmountCryptoPrecision || swap.expectedBuyAmountCryptoPrecision);
        body = `Your swap of ${this.formatAmount(swap.sellAmountCryptoPrecision)} ${sellAsset.symbol} to ${buyAmount} ${buyAsset.symbol} is complete.`;
        type = 'SWAP_COMPLETED';
        break;
      case 'FAILED':
        title = 'Swap Failed';
        body = `Your ${sellAsset.symbol} to ${buyAsset.symbol} swap has failed`;
        type = 'SWAP_FAILED';
        break;
      default:
        return;
    }

    if (swap.status === 'FAILED' || swap.status === 'SUCCESS') {
      await this.notificationsClient.createNotification({
        userId: swap.userId,
        title,
        body,
        type,
        swapId: swap.id,
      });
    }
  }

  async getSwapsByUser(userId: string, limit = 50) {
    const swaps = await this.prisma.swap.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        notifications: {
          orderBy: { sentAt: 'desc' },
          take: 5,
        },
      },
    });

    return swaps.map(swap => ({
      ...swap,
      sellAsset: swap.sellAsset as Asset,
      buyAsset: swap.buyAsset as Asset,
    }));
  }

  async getSwapsByAccountId(accountId: string) {
    const hashedAccountId = hashAccountId(accountId);
    const swaps = await this.prisma.swap.findMany({
      where: {
        OR: [
          { sellAccountId: hashedAccountId },
          { buyAccountId: hashedAccountId },
        ],
      },
    });

    return swaps.map(swap => ({
      ...swap,
      sellAsset: swap.sellAsset,
      buyAsset: swap.buyAsset,
    }));
  }

  async getPendingSwaps() {
    const swaps = await this.prisma.swap.findMany({
      where: {
        status: {
          in: ['IDLE', 'PENDING'],
        },
      },
    });

    return swaps.map(swap => ({
      ...swap,
      sellAsset: swap.sellAsset,
      buyAsset: swap.buyAsset,
    }));
  }

  async pollSwapStatus(swapId: string): Promise<SwapStatusResponse> {
    try {
      this.logger.log(`Polling status for swap: ${swapId}`);
      
      const swap = await this.prisma.swap.findUnique({
        where: { swapId },
      });
      
      if (!swap) {
        throw new Error(`Swap not found: ${swapId}`);
      }

      const sellAsset = swap.sellAsset as Asset;

      const swapper = swappers[swap.swapperName];
      
      if (!swapper) {
        throw new Error(`Swapper not found: ${swap.swapperName}`);
      }

      if (!swap.sellTxHash) {
        throw new Error('Sell tx hash is required');
      }

      const status = await swapper.checkTradeStatus({
        txHash: swap.sellTxHash ?? '',
        chainId: sellAsset.chainId as ChainId,
        address: swap.sellAccountId,
        swap: {
          ...swap,
          id: swap.swapId,
          createdAt: swap.createdAt.getTime(),
          updatedAt: swap.updatedAt.getTime(),
        },
        stepIndex: 0,
        config: {
          VITE_UNCHAINED_THORCHAIN_HTTP_URL: process.env.VITE_UNCHAINED_THORCHAIN_HTTP_URL || '',
          VITE_UNCHAINED_MAYACHAIN_HTTP_URL: process.env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL || '',
          VITE_UNCHAINED_COSMOS_HTTP_URL: process.env.VITE_UNCHAINED_COSMOS_HTTP_URL || '',
          VITE_THORCHAIN_NODE_URL: process.env.VITE_THORCHAIN_NODE_URL || '',
          VITE_MAYACHAIN_NODE_URL: process.env.VITE_MAYACHAIN_NODE_URL || '',
          VITE_COWSWAP_BASE_URL: process.env.VITE_COWSWAP_BASE_URL || '',
          VITE_CHAINFLIP_API_KEY: process.env.VITE_CHAINFLIP_API_KEY || '',
          VITE_CHAINFLIP_API_URL: process.env.VITE_CHAINFLIP_API_URL || '',
          VITE_JUPITER_API_URL: process.env.VITE_JUPITER_API_URL || '',
          VITE_RELAY_API_URL: process.env.VITE_RELAY_API_URL || '',
          VITE_PORTALS_BASE_URL: process.env.VITE_PORTALS_BASE_URL || '',
          VITE_ZRX_BASE_URL: process.env.VITE_ZRX_BASE_URL || '',
          VITE_THORCHAIN_MIDGARD_URL: process.env.VITE_THORCHAIN_MIDGARD_URL || '',
          VITE_MAYACHAIN_MIDGARD_URL: process.env.VITE_MAYACHAIN_MIDGARD_URL || '',
          VITE_UNCHAINED_BITCOIN_HTTP_URL: process.env.VITE_UNCHAINED_BITCOIN_HTTP_URL || '',
          VITE_UNCHAINED_DOGECOIN_HTTP_URL: process.env.VITE_UNCHAINED_DOGECOIN_HTTP_URL || '',
          VITE_UNCHAINED_LITECOIN_HTTP_URL: process.env.VITE_UNCHAINED_LITECOIN_HTTP_URL || '',
          VITE_UNCHAINED_BITCOINCASH_HTTP_URL: process.env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL || '',
          VITE_UNCHAINED_ETHEREUM_HTTP_URL: process.env.VITE_UNCHAINED_ETHEREUM_HTTP_URL || '',
          VITE_UNCHAINED_AVALANCHE_HTTP_URL: process.env.VITE_UNCHAINED_AVALANCHE_HTTP_URL || '',
          VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL: process.env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL || '',
          VITE_UNCHAINED_BASE_HTTP_URL: process.env.VITE_UNCHAINED_BASE_HTTP_URL || '',
          VITE_FEATURE_THORCHAINSWAP_LONGTAIL: true,
          VITE_FEATURE_THORCHAINSWAP_L1_TO_LONGTAIL: true,
          VITE_FEATURE_CHAINFLIP_SWAP_DCA: true,
        },
        assertGetSolanaChainAdapter: (chainId: ChainId) => {
          return this.solanaChainAdapterService.assertGetSolanaChainAdapter(chainId);
        },
        assertGetUtxoChainAdapter: (chainId: ChainId) => {
          return this.utxoChainAdapterService.assertGetUtxoChainAdapter(chainId);
        },
        assertGetCosmosSdkChainAdapter: (chainId: ChainId) => {
          return this.cosmosSdkChainAdapterService.assertGetCosmosSdkChainAdapter(chainId);
        },
        assertGetEvmChainAdapter: (chainId: ChainId) => {
          return this.evmChainAdapterService.assertGetEvmChainAdapter(chainId);
        },
        fetchIsSmartContractAddressQuery: () => Promise.resolve(false),
      });

      return {
        status: status.status === 'Confirmed' ? 'SUCCESS' : 
                status.status === 'Failed' ? 'FAILED' : 'PENDING',
        sellTxHash: swap.sellTxHash,
        buyTxHash: status.buyTxHash,
        statusMessage: status.message,
      };
    } catch (error) {
      this.logger.error(`Failed to poll swap status for ${swapId}:`, error);
      return {
        status: 'PENDING',
        statusMessage: `Error polling status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
