import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletManagerService, EvmChain, UtxoChain, CosmosChain } from '../wallet/wallet-manager.service';
import { SwapperManagerService } from '../swappers/swapper-manager.service';
import { GasCalculatorService, ChainId } from '../swappers/gas-calculator.service';
import { SwapperType, SwapperName } from '../swappers/swapper.types';
import { Quote, QuoteStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Quote expiration time in minutes
 */
const QUOTE_EXPIRATION_MINUTES = 30;

/**
 * Chain family identifiers for deposit address generation
 */
type ChainFamily = 'EVM' | 'UTXO' | 'COSMOS' | 'SOLANA';

/**
 * Chain info extracted from asset ID
 */
interface ChainInfo {
  family: ChainFamily;
  chainId: ChainId;
  evmChain?: EvmChain;
  utxoChain?: UtxoChain;
  cosmosChain?: CosmosChain;
}

/**
 * DTO for creating a new quote
 */
export interface CreateQuoteDto {
  sellAssetId: string;
  buyAssetId: string;
  sellAmountCryptoBaseUnit: string;
  receiveAddress: string;
  swapperName: SwapperName;
  expectedBuyAmountCryptoBaseUnit: string;
  sellAsset: Record<string, unknown>;
  buyAsset: Record<string, unknown>;
}

/**
 * DTO for quote response
 */
export interface QuoteResponse {
  quoteId: string;
  status: QuoteStatus;
  depositAddress: string;
  receiveAddress: string;
  sellAsset: Record<string, unknown>;
  buyAsset: Record<string, unknown>;
  sellAmountCryptoBaseUnit: string;
  expectedBuyAmountCryptoBaseUnit: string;
  swapperName: string;
  swapperType: SwapperType;
  gasOverheadBaseUnit: string | null;
  expiresAt: Date;
  createdAt: Date;
  qrData: string;
}

/**
 * QuotesService handles quote generation and management for send-swap operations.
 *
 * Key responsibilities:
 * - Generate quotes with 30-minute expiration
 * - Generate deposit addresses based on sell asset chain
 * - Calculate gas overhead for service-wallet swappers
 * - Manage quote lifecycle (active, expired, completed, etc.)
 */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private prisma: PrismaService,
    private walletManager: WalletManagerService,
    private swapperManager: SwapperManagerService,
    private gasCalculator: GasCalculatorService,
  ) {}

  /**
   * Create a new quote for a send-swap operation.
   *
   * @param data - Quote creation parameters
   * @returns The created quote with deposit address and expiration
   */
  async createQuote(data: CreateQuoteDto): Promise<QuoteResponse> {
    try {
      // Validate swapper is valid for send-swap
      if (!this.swapperManager.isValidSwapper(data.swapperName)) {
        throw new BadRequestException(
          `Swapper ${data.swapperName} is not supported for send-swap operations`,
        );
      }

      // Get swapper type
      const swapperType = this.swapperManager.getSwapperType(data.swapperName);

      // Extract chain info from sell asset
      const chainInfo = this.extractChainInfo(data.sellAssetId);
      if (!chainInfo) {
        throw new BadRequestException(
          `Unsupported chain for asset: ${data.sellAssetId}`,
        );
      }

      // Generate unique quote ID
      const quoteId = `quote_${randomUUID().replace(/-/g, '').substring(0, 16)}`;

      // Get the next available address index for unique deposit address
      const addressIndex = await this.getNextAddressIndex();

      // Generate deposit address based on chain family
      const depositAddress = await this.generateDepositAddress(chainInfo, addressIndex);

      // Calculate gas overhead for service-wallet swappers
      let gasOverheadBaseUnit: string | null = null;
      if (swapperType === SwapperType.SERVICE_WALLET) {
        gasOverheadBaseUnit = this.gasCalculator.calculateGasOverhead(
          chainInfo.chainId,
          swapperType,
        );
        this.logger.debug(
          `Gas overhead for ${data.swapperName} on ${chainInfo.chainId}: ${gasOverheadBaseUnit}`,
        );
      }

      // Calculate expiration time (30 minutes from now)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + QUOTE_EXPIRATION_MINUTES);

      // Create quote in database
      const quote = await this.prisma.quote.create({
        data: {
          quoteId,
          status: QuoteStatus.ACTIVE,
          sellAsset: data.sellAsset as Prisma.InputJsonValue,
          buyAsset: data.buyAsset as Prisma.InputJsonValue,
          sellAmountCryptoBaseUnit: data.sellAmountCryptoBaseUnit,
          expectedBuyAmountCryptoBaseUnit: data.expectedBuyAmountCryptoBaseUnit,
          depositAddress,
          receiveAddress: data.receiveAddress,
          swapperName: data.swapperName,
          swapperType: swapperType === SwapperType.DIRECT ? 'DIRECT' : 'SERVICE_WALLET',
          gasOverheadBaseUnit,
          expiresAt,
        },
      });

      this.logger.log(
        `Quote created: ${quoteId}, swapper: ${data.swapperName}, type: ${swapperType}, expires: ${expiresAt.toISOString()}`,
      );

      return this.formatQuoteResponse(quote);
    } catch (error) {
      this.logger.error('Failed to create quote', error);
      throw error;
    }
  }

  /**
   * Get a quote by its unique ID.
   *
   * @param quoteId - The quote identifier
   * @returns The quote with current status
   */
  async getQuote(quoteId: string): Promise<QuoteResponse> {
    const quote = await this.prisma.quote.findUnique({
      where: { quoteId },
    });

    if (!quote) {
      throw new NotFoundException(`Quote not found: ${quoteId}`);
    }

    // Check and update expiration status if needed
    const updatedQuote = await this.checkAndUpdateExpiration(quote);

    return this.formatQuoteResponse(updatedQuote);
  }

  /**
   * Get a quote by deposit address.
   *
   * @param depositAddress - The deposit address to search for
   * @returns The quote if found
   */
  async getQuoteByDepositAddress(depositAddress: string): Promise<Quote | null> {
    const quote = await this.prisma.quote.findFirst({
      where: {
        depositAddress,
        status: QuoteStatus.ACTIVE,
      },
    });

    if (quote) {
      return this.checkAndUpdateExpiration(quote);
    }

    return null;
  }

  /**
   * Get all active (non-expired) quotes.
   *
   * @returns List of active quotes
   */
  async getActiveQuotes(): Promise<Quote[]> {
    const now = new Date();

    const quotes = await this.prisma.quote.findMany({
      where: {
        status: QuoteStatus.ACTIVE,
        expiresAt: {
          gt: now,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return quotes;
  }

  /**
   * Get quotes that need expiration check.
   * Used by the deposit monitor to efficiently query active quotes.
   *
   * @returns List of quotes to monitor
   */
  async getQuotesToMonitor(): Promise<Quote[]> {
    const now = new Date();

    return this.prisma.quote.findMany({
      where: {
        status: {
          in: [QuoteStatus.ACTIVE, QuoteStatus.DEPOSIT_RECEIVED],
        },
        expiresAt: {
          gt: now,
        },
      },
    });
  }

  /**
   * Update quote status when deposit is received.
   *
   * @param quoteId - The quote identifier
   * @param depositTxHash - The deposit transaction hash
   * @returns Updated quote
   */
  async markDepositReceived(quoteId: string, depositTxHash: string): Promise<Quote> {
    const quote = await this.prisma.quote.findUnique({
      where: { quoteId },
    });

    if (!quote) {
      throw new NotFoundException(`Quote not found: ${quoteId}`);
    }

    // Check if quote is expired
    if (quote.expiresAt < new Date()) {
      throw new BadRequestException(`Quote ${quoteId} has expired`);
    }

    // Check if quote is in valid state for deposit
    if (quote.status !== QuoteStatus.ACTIVE) {
      throw new BadRequestException(
        `Quote ${quoteId} is not in ACTIVE status (current: ${quote.status})`,
      );
    }

    const updatedQuote = await this.prisma.quote.update({
      where: { quoteId },
      data: {
        status: QuoteStatus.DEPOSIT_RECEIVED,
        depositTxHash,
      },
    });

    this.logger.log(`Deposit received for quote ${quoteId}: ${depositTxHash}`);

    return updatedQuote;
  }

  /**
   * Update quote status to executing.
   *
   * @param quoteId - The quote identifier
   * @returns Updated quote
   */
  async markExecuting(quoteId: string): Promise<Quote> {
    const updatedQuote = await this.prisma.quote.update({
      where: { quoteId },
      data: {
        status: QuoteStatus.EXECUTING,
      },
    });

    this.logger.log(`Quote ${quoteId} is now executing`);

    return updatedQuote;
  }

  /**
   * Mark quote as completed after successful swap execution.
   *
   * @param quoteId - The quote identifier
   * @param executionTxHash - The swap execution transaction hash
   * @returns Updated quote
   */
  async markCompleted(quoteId: string, executionTxHash: string): Promise<Quote> {
    const updatedQuote = await this.prisma.quote.update({
      where: { quoteId },
      data: {
        status: QuoteStatus.COMPLETED,
        executionTxHash,
        executedAt: new Date(),
      },
    });

    this.logger.log(`Quote ${quoteId} completed: ${executionTxHash}`);

    return updatedQuote;
  }

  /**
   * Mark quote as failed.
   *
   * @param quoteId - The quote identifier
   * @returns Updated quote
   */
  async markFailed(quoteId: string): Promise<Quote> {
    const updatedQuote = await this.prisma.quote.update({
      where: { quoteId },
      data: {
        status: QuoteStatus.FAILED,
      },
    });

    this.logger.log(`Quote ${quoteId} marked as failed`);

    return updatedQuote;
  }

  /**
   * Expire all quotes that have passed their expiration time.
   * Called by cron job to clean up stale quotes.
   *
   * @returns Number of quotes expired
   */
  async expireStaleQuotes(): Promise<number> {
    const now = new Date();

    const result = await this.prisma.quote.updateMany({
      where: {
        status: QuoteStatus.ACTIVE,
        expiresAt: {
          lte: now,
        },
      },
      data: {
        status: QuoteStatus.EXPIRED,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} stale quotes`);
    }

    return result.count;
  }

  /**
   * Extract chain information from a CAIP-19 asset ID.
   * Maps asset IDs to chain families and specific chain identifiers.
   *
   * @param assetId - CAIP-19 asset identifier (e.g., "eip155:1/slip44:60")
   * @returns Chain information or undefined if unsupported
   */
  private extractChainInfo(assetId: string): ChainInfo | undefined {
    const chainPart = assetId.split('/')[0];

    if (!chainPart) {
      return undefined;
    }

    // EVM chains
    if (chainPart.startsWith('eip155:')) {
      const chainId = chainPart as ChainId;
      const evmChainMap: Record<string, EvmChain> = {
        'eip155:1': 'ETH',
        'eip155:43114': 'AVAX',
        'eip155:56': 'BSC',
        'eip155:137': 'POLYGON',
        'eip155:10': 'OPTIMISM',
        'eip155:42161': 'ARBITRUM',
        'eip155:8453': 'BASE',
        'eip155:100': 'GNOSIS',
      };

      const evmChain = evmChainMap[chainPart];
      if (evmChain) {
        return { family: 'EVM', chainId, evmChain };
      }
    }

    // UTXO chains
    if (chainPart.startsWith('bip122:')) {
      const chainId = chainPart as ChainId;
      const utxoChainMap: Record<string, UtxoChain> = {
        'bip122:000000000019d6689c085ae165831e93': 'BTC',
        'bip122:12a765e31ffd4059bada1e25190f6e98': 'LTC',
        'bip122:1a91e3dace36e2be3bf030a65679fe82': 'DOGE',
        'bip122:000000000000000000651ef99cb9fcbe': 'BCH',
      };

      const utxoChain = utxoChainMap[chainPart];
      if (utxoChain) {
        return { family: 'UTXO', chainId, utxoChain };
      }
    }

    // Cosmos-SDK chains
    if (chainPart.startsWith('cosmos:')) {
      const chainId = chainPart as ChainId;
      const cosmosChainMap: Record<string, CosmosChain> = {
        'cosmos:cosmoshub-4': 'ATOM',
        'cosmos:osmosis-1': 'OSMO',
      };

      const cosmosChain = cosmosChainMap[chainPart];
      if (cosmosChain) {
        return { family: 'COSMOS', chainId, cosmosChain };
      }
    }

    // Solana
    if (chainPart === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
      return { family: 'SOLANA', chainId: ChainId.SOL };
    }

    return undefined;
  }

  /**
   * Generate a deposit address based on the chain family.
   *
   * @param chainInfo - Chain information
   * @param addressIndex - Index for unique address generation
   * @returns The deposit address
   */
  private async generateDepositAddress(
    chainInfo: ChainInfo,
    addressIndex: number,
  ): Promise<string> {
    switch (chainInfo.family) {
      case 'EVM':
        return this.walletManager.getEvmDepositAddress(
          chainInfo.evmChain!,
          addressIndex,
        );

      case 'UTXO':
        return this.walletManager.getUtxoDepositAddress(
          chainInfo.utxoChain!,
          addressIndex,
        );

      case 'COSMOS':
        return this.walletManager.getCosmosDepositAddress(
          chainInfo.cosmosChain!,
          addressIndex,
        );

      case 'SOLANA':
        return this.walletManager.getSolanaDepositAddress(addressIndex);

      default:
        throw new BadRequestException(
          `Unsupported chain family: ${chainInfo.family}`,
        );
    }
  }

  /**
   * Get the next available address index for unique deposit address generation.
   * Uses the total quote count as a simple incrementing index.
   *
   * @returns The next address index
   */
  private async getNextAddressIndex(): Promise<number> {
    const count = await this.prisma.quote.count();
    return count;
  }

  /**
   * Check if a quote has expired and update its status if needed.
   *
   * @param quote - The quote to check
   * @returns The quote with updated status if expired
   */
  private async checkAndUpdateExpiration(quote: Quote): Promise<Quote> {
    if (quote.status === QuoteStatus.ACTIVE && quote.expiresAt < new Date()) {
      return this.prisma.quote.update({
        where: { id: quote.id },
        data: { status: QuoteStatus.EXPIRED },
      });
    }
    return quote;
  }

  /**
   * Format a quote entity into a response DTO with QR data.
   *
   * @param quote - The quote entity
   * @returns Formatted quote response
   */
  private formatQuoteResponse(quote: Quote): QuoteResponse {
    // Generate QR-friendly data for deposit
    // Format depends on the chain (ethereum: for EVM, bitcoin: for BTC, etc.)
    const qrData = this.generateQrData(quote);

    return {
      quoteId: quote.quoteId,
      status: quote.status,
      depositAddress: quote.depositAddress,
      receiveAddress: quote.receiveAddress,
      sellAsset: quote.sellAsset as Record<string, unknown>,
      buyAsset: quote.buyAsset as Record<string, unknown>,
      sellAmountCryptoBaseUnit: quote.sellAmountCryptoBaseUnit,
      expectedBuyAmountCryptoBaseUnit: quote.expectedBuyAmountCryptoBaseUnit,
      swapperName: quote.swapperName,
      swapperType: quote.swapperType === 'DIRECT' ? SwapperType.DIRECT : SwapperType.SERVICE_WALLET,
      gasOverheadBaseUnit: quote.gasOverheadBaseUnit,
      expiresAt: quote.expiresAt,
      createdAt: quote.createdAt,
      qrData,
    };
  }

  /**
   * Generate QR-friendly data for a deposit address.
   * Uses standard URI schemes for different chains.
   *
   * @param quote - The quote to generate QR data for
   * @returns QR-friendly URI string
   */
  private generateQrData(quote: Quote): string {
    const { depositAddress, sellAmountCryptoBaseUnit } = quote;

    // Determine chain type from swapper type or deposit address format
    // EVM addresses start with 0x
    if (depositAddress.startsWith('0x')) {
      return `ethereum:${depositAddress}?value=${sellAmountCryptoBaseUnit}`;
    }

    // Bitcoin addresses - native segwit starts with bc1, legacy with 1 or 3
    if (
      depositAddress.startsWith('bc1') ||
      depositAddress.startsWith('1') ||
      depositAddress.startsWith('3')
    ) {
      return `bitcoin:${depositAddress}?amount=${this.satoshiToBtc(sellAmountCryptoBaseUnit)}`;
    }

    // Litecoin - segwit starts with ltc1, legacy with L or M
    if (
      depositAddress.startsWith('ltc1') ||
      depositAddress.startsWith('L') ||
      depositAddress.startsWith('M')
    ) {
      return `litecoin:${depositAddress}?amount=${this.satoshiToBtc(sellAmountCryptoBaseUnit)}`;
    }

    // Dogecoin - starts with D
    if (depositAddress.startsWith('D')) {
      return `dogecoin:${depositAddress}?amount=${this.satoshiToBtc(sellAmountCryptoBaseUnit)}`;
    }

    // Bitcoin Cash - starts with q or bitcoincash:
    if (
      depositAddress.startsWith('q') ||
      depositAddress.startsWith('bitcoincash:')
    ) {
      const bchAddress = depositAddress.replace('bitcoincash:', '');
      return `bitcoincash:${bchAddress}?amount=${this.satoshiToBtc(sellAmountCryptoBaseUnit)}`;
    }

    // Cosmos addresses - start with cosmos
    if (depositAddress.startsWith('cosmos')) {
      return `cosmos:${depositAddress}?amount=${this.microToUnit(sellAmountCryptoBaseUnit)}`;
    }

    // Osmosis addresses - start with osmo
    if (depositAddress.startsWith('osmo')) {
      return `osmosis:${depositAddress}?amount=${this.microToUnit(sellAmountCryptoBaseUnit)}`;
    }

    // Solana - base58 encoded, typically 32-44 characters
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(depositAddress)) {
      return `solana:${depositAddress}?amount=${this.lamportsToSol(sellAmountCryptoBaseUnit)}`;
    }

    // Default fallback - just return the address
    return depositAddress;
  }

  /**
   * Convert satoshi to BTC for QR amount formatting
   */
  private satoshiToBtc(satoshi: string): string {
    const btc = BigInt(satoshi) / BigInt(100000000);
    const remainder = BigInt(satoshi) % BigInt(100000000);
    if (remainder === BigInt(0)) {
      return btc.toString();
    }
    return `${btc}.${remainder.toString().padStart(8, '0').replace(/0+$/, '')}`;
  }

  /**
   * Convert micro units to base units (e.g., uatom to ATOM)
   */
  private microToUnit(micro: string): string {
    const unit = BigInt(micro) / BigInt(1000000);
    const remainder = BigInt(micro) % BigInt(1000000);
    if (remainder === BigInt(0)) {
      return unit.toString();
    }
    return `${unit}.${remainder.toString().padStart(6, '0').replace(/0+$/, '')}`;
  }

  /**
   * Convert lamports to SOL
   */
  private lamportsToSol(lamports: string): string {
    const sol = BigInt(lamports) / BigInt(1000000000);
    const remainder = BigInt(lamports) % BigInt(1000000000);
    if (remainder === BigInt(0)) {
      return sol.toString();
    }
    return `${sol}.${remainder.toString().padStart(9, '0').replace(/0+$/, '')}`;
  }
}
