import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { QuotesService } from '../quotes/quotes.service';
import { Quote, QuoteStatus } from '@prisma/client';
import { firstValueFrom } from 'rxjs';

/**
 * Chain family types for deposit detection
 */
type ChainFamily = 'EVM' | 'UTXO' | 'COSMOS' | 'SOLANA' | 'UNKNOWN';

/**
 * Result of a deposit check for a specific address
 */
interface DepositCheckResult {
  found: boolean;
  txHash?: string;
  amount?: string;
  confirmations?: number;
  isPartial?: boolean;
  isOverDeposit?: boolean;
}

/**
 * Transaction info from blockchain query
 */
interface TransactionInfo {
  txHash: string;
  amount: string;
  confirmations: number;
  timestamp: number;
}

/**
 * Minimum confirmations required per chain family
 */
const MIN_CONFIRMATIONS: Record<ChainFamily, number> = {
  EVM: 12, // ~3 minutes on Ethereum
  UTXO: 3, // ~30 minutes for BTC
  COSMOS: 1, // Near instant finality
  SOLANA: 32, // Solana finality
  UNKNOWN: 1,
};

/**
 * Tolerance percentage for amount matching (allows for minor fee variations)
 * Set to 0.1% tolerance
 */
const AMOUNT_TOLERANCE_PERCENT = 0.1;

/**
 * DepositMonitorService monitors deposit addresses for incoming funds.
 *
 * This service runs a cron job every 30 seconds to:
 * - Fetch active quotes that need deposit monitoring
 * - Check deposit addresses for incoming transactions
 * - Update quote status when deposits are detected
 *
 * The monitoring process is chain-aware and handles different
 * blockchain families (EVM, UTXO, Cosmos, Solana) appropriately.
 */
@Injectable()
export class DepositMonitorService {
  private readonly logger = new Logger(DepositMonitorService.name);

  constructor(
    private quotesService: QuotesService,
    private configService: ConfigService,
    private httpService: HttpService,
  ) {}

  /**
   * Check for deposits on active quote deposit addresses.
   * Runs every 30 seconds via cron scheduler.
   *
   * This method:
   * 1. Fetches all active quotes that need monitoring
   * 2. Checks each deposit address for incoming transactions
   * 3. Updates quote status when deposits are detected
   * 4. Handles errors gracefully to prevent job failures
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkDeposits(): Promise<void> {
    try {
      this.logger.log('Starting deposit check...');

      // Get quotes that need deposit monitoring
      const quotesToMonitor = await this.quotesService.getQuotesToMonitor();

      if (quotesToMonitor.length === 0) {
        this.logger.log('No quotes to monitor');
        return;
      }

      this.logger.log(`Found ${quotesToMonitor.length} quotes to monitor for deposits`);

      // Process each quote for deposit checking
      for (const quote of quotesToMonitor) {
        try {
          // Only check ACTIVE quotes for new deposits
          if (quote.status === QuoteStatus.ACTIVE) {
            await this.checkDepositForQuote(quote);
          }
        } catch (error) {
          this.logger.error(
            `Failed to check deposit for quote ${quote.quoteId}:`,
            error,
          );
        }
      }

      this.logger.log('Deposit check completed');
    } catch (error) {
      this.logger.error('Failed to check deposits:', error);
    }
  }

  /**
   * Check deposit for a specific quote.
   * Matches deposits by address AND amount, with chain-aware confirmation handling.
   *
   * @param quote - The quote to check for deposits
   */
  private async checkDepositForQuote(quote: Quote): Promise<void> {
    const { quoteId, depositAddress, sellAmountCryptoBaseUnit } = quote;

    this.logger.debug(
      `Checking deposit for quote ${quoteId} at address ${depositAddress} for amount ${sellAmountCryptoBaseUnit}`,
    );

    // Determine chain family from deposit address
    const chainFamily = this.getChainFamily(depositAddress);
    if (chainFamily === 'UNKNOWN') {
      this.logger.warn(`Unknown chain family for address ${depositAddress}`);
      return;
    }

    // Check for deposit matching address + amount
    const depositResult = await this.checkDepositReceived(
      depositAddress,
      sellAmountCryptoBaseUnit,
      chainFamily,
    );

    if (depositResult.found && depositResult.txHash) {
      // Verify sufficient confirmations
      const minConfirmations = MIN_CONFIRMATIONS[chainFamily];
      const hasEnoughConfirmations = (depositResult.confirmations ?? 0) >= minConfirmations;

      if (!hasEnoughConfirmations) {
        this.logger.debug(
          `Deposit found for quote ${quoteId} but needs more confirmations ` +
          `(${depositResult.confirmations}/${minConfirmations})`,
        );
        return;
      }

      // Handle partial deposits - log but don't process yet
      if (depositResult.isPartial) {
        this.logger.warn(
          `Partial deposit detected for quote ${quoteId}: ` +
          `received ${depositResult.amount}, expected ${sellAmountCryptoBaseUnit}`,
        );
        // TODO: In future, implement partial deposit handling (wait for more or refund)
        return;
      }

      // Handle over-deposits - process but log for potential refund
      if (depositResult.isOverDeposit) {
        this.logger.warn(
          `Over-deposit detected for quote ${quoteId}: ` +
          `received ${depositResult.amount}, expected ${sellAmountCryptoBaseUnit}`,
        );
        // TODO: In future, implement excess amount refund logic
      }

      // Mark deposit as received
      this.logger.log(
        `Deposit confirmed for quote ${quoteId}: ${depositResult.txHash} ` +
        `(${depositResult.confirmations} confirmations)`,
      );

      await this.quotesService.markDepositReceived(quoteId, depositResult.txHash);
    }
  }

  /**
   * Check if a deposit has been received at the given address matching the expected amount.
   *
   * This method queries the appropriate blockchain based on the chain family.
   *
   * @param depositAddress - The deposit address to check
   * @param expectedAmount - The expected deposit amount in base units
   * @param chainFamily - The blockchain family (EVM, UTXO, COSMOS, SOLANA)
   * @returns Deposit check result with match status and transaction details
   */
  async checkDepositReceived(
    depositAddress: string,
    expectedAmount: string,
    chainFamily: ChainFamily,
  ): Promise<DepositCheckResult> {
    try {
      // Get transactions for the deposit address
      const transactions = await this.getAddressTransactions(depositAddress, chainFamily);

      if (transactions.length === 0) {
        return { found: false };
      }

      // Find a transaction matching the expected amount
      for (const tx of transactions) {
        const matchResult = this.matchAmount(tx.amount, expectedAmount);

        if (matchResult.matches) {
          return {
            found: true,
            txHash: tx.txHash,
            amount: tx.amount,
            confirmations: tx.confirmations,
            isPartial: matchResult.isPartial,
            isOverDeposit: matchResult.isOverDeposit,
          };
        }
      }

      // Check if there's a partial deposit (received less than expected)
      const totalReceived = transactions.reduce(
        (sum, tx) => BigInt(sum) + BigInt(tx.amount),
        BigInt(0),
      );

      const expectedBigInt = BigInt(expectedAmount);
      if (totalReceived > BigInt(0) && totalReceived < expectedBigInt) {
        // Return the largest transaction as a partial indicator
        const largestTx = transactions.reduce((max, tx) =>
          BigInt(tx.amount) > BigInt(max.amount) ? tx : max,
        );

        return {
          found: true,
          txHash: largestTx.txHash,
          amount: totalReceived.toString(),
          confirmations: largestTx.confirmations,
          isPartial: true,
        };
      }

      return { found: false };
    } catch (error) {
      this.logger.error(
        `Failed to check deposit at ${depositAddress}:`,
        error,
      );
      return { found: false };
    }
  }

  /**
   * Match a received amount against an expected amount with tolerance.
   *
   * @param receivedAmount - The amount received in base units
   * @param expectedAmount - The expected amount in base units
   * @returns Match result indicating exact match, partial, or over-deposit
   */
  private matchAmount(
    receivedAmount: string,
    expectedAmount: string,
  ): { matches: boolean; isPartial?: boolean; isOverDeposit?: boolean } {
    const received = BigInt(receivedAmount);
    const expected = BigInt(expectedAmount);

    // Calculate tolerance (0.1% of expected)
    const tolerance = (expected * BigInt(Math.floor(AMOUNT_TOLERANCE_PERCENT * 10))) / BigInt(1000);

    // Exact match (within tolerance)
    const lowerBound = expected - tolerance;
    const upperBound = expected + tolerance;

    if (received >= lowerBound && received <= upperBound) {
      return { matches: true };
    }

    // Over-deposit (more than expected + tolerance)
    if (received > upperBound) {
      return { matches: true, isOverDeposit: true };
    }

    // Partial deposit (less than expected - tolerance)
    if (received > BigInt(0) && received < lowerBound) {
      return { matches: false, isPartial: true };
    }

    return { matches: false };
  }

  /**
   * Determine the chain family from a deposit address format.
   *
   * @param address - The deposit address
   * @returns The chain family identifier
   */
  getChainFamily(address: string): ChainFamily {
    // EVM addresses start with 0x and are 42 characters
    if (address.startsWith('0x') && address.length === 42) {
      return 'EVM';
    }

    // Bitcoin - native segwit (bc1), legacy (1 or 3)
    if (
      address.startsWith('bc1') ||
      (address.startsWith('1') && address.length >= 26 && address.length <= 35) ||
      (address.startsWith('3') && address.length >= 26 && address.length <= 35)
    ) {
      return 'UTXO';
    }

    // Litecoin - segwit (ltc1), legacy (L or M)
    if (
      address.startsWith('ltc1') ||
      address.startsWith('L') ||
      address.startsWith('M')
    ) {
      return 'UTXO';
    }

    // Dogecoin - starts with D
    if (address.startsWith('D') && address.length >= 26 && address.length <= 35) {
      return 'UTXO';
    }

    // Bitcoin Cash - starts with q or bitcoincash:
    if (address.startsWith('q') || address.startsWith('bitcoincash:')) {
      return 'UTXO';
    }

    // Cosmos addresses - start with cosmos
    if (address.startsWith('cosmos')) {
      return 'COSMOS';
    }

    // Osmosis addresses - start with osmo
    if (address.startsWith('osmo')) {
      return 'COSMOS';
    }

    // Solana - base58 encoded, typically 32-44 characters
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return 'SOLANA';
    }

    return 'UNKNOWN';
  }

  /**
   * Get transactions for an address from the appropriate blockchain.
   *
   * This method queries Unchained APIs for transaction data.
   * In a production system, this would integrate with the actual blockchain APIs.
   *
   * @param address - The address to query
   * @param chainFamily - The blockchain family
   * @returns Array of transactions for the address
   */
  private async getAddressTransactions(
    address: string,
    chainFamily: ChainFamily,
  ): Promise<TransactionInfo[]> {
    try {
      switch (chainFamily) {
        case 'EVM':
          return this.getEvmTransactions(address);
        case 'UTXO':
          return this.getUtxoTransactions(address);
        case 'COSMOS':
          return this.getCosmosTransactions(address);
        case 'SOLANA':
          return this.getSolanaTransactions(address);
        default:
          return [];
      }
    } catch (error) {
      this.logger.error(
        `Failed to get transactions for ${address} on ${chainFamily}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get EVM transactions for an address.
   * Queries Unchained Ethereum API for incoming transactions.
   *
   * @param address - The EVM address
   * @returns Array of incoming transactions
   */
  private async getEvmTransactions(address: string): Promise<TransactionInfo[]> {
    const unchainedUrl = this.configService.get<string>('UNCHAINED_ETHEREUM_HTTP_URL');

    if (!unchainedUrl) {
      this.logger.debug('UNCHAINED_ETHEREUM_HTTP_URL not configured, skipping EVM check');
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${unchainedUrl}/api/v1/account/${address}/txs`, {
          params: { pageSize: 10 },
          timeout: 10000,
        }),
      );

      const txs = response.data?.txs || [];

      return txs
        .filter((tx: Record<string, unknown>) => {
          // Filter for incoming transactions to this address
          const transfers = (tx.transfers as Array<{ type: string; to: string; value: string }>) || [];
          return transfers.some(
            (t) => t.type === 'receive' && t.to.toLowerCase() === address.toLowerCase(),
          );
        })
        .map((tx: Record<string, unknown>) => {
          const transfers = (tx.transfers as Array<{ type: string; to: string; value: string }>) || [];
          const incomingTransfer = transfers.find(
            (t) => t.type === 'receive' && t.to.toLowerCase() === address.toLowerCase(),
          );

          return {
            txHash: tx.txid as string,
            amount: incomingTransfer?.value || '0',
            confirmations: (tx.confirmations as number) || 0,
            timestamp: (tx.timestamp as number) || 0,
          };
        });
    } catch {
      this.logger.debug(`No EVM transactions found for ${address}`);
      return [];
    }
  }

  /**
   * Get UTXO transactions for an address.
   * Queries Unchained Bitcoin API for incoming transactions.
   *
   * @param address - The UTXO address
   * @returns Array of incoming transactions
   */
  private async getUtxoTransactions(address: string): Promise<TransactionInfo[]> {
    // Determine which Unchained endpoint to use based on address format
    let unchainedUrl: string | undefined;

    if (address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3')) {
      unchainedUrl = this.configService.get<string>('UNCHAINED_BITCOIN_HTTP_URL');
    } else if (address.startsWith('ltc1') || address.startsWith('L') || address.startsWith('M')) {
      unchainedUrl = this.configService.get<string>('UNCHAINED_LITECOIN_HTTP_URL');
    } else if (address.startsWith('D')) {
      unchainedUrl = this.configService.get<string>('UNCHAINED_DOGECOIN_HTTP_URL');
    } else if (address.startsWith('q') || address.startsWith('bitcoincash:')) {
      unchainedUrl = this.configService.get<string>('UNCHAINED_BITCOINCASH_HTTP_URL');
    }

    if (!unchainedUrl) {
      this.logger.debug('Unchained URL not configured for UTXO address, skipping check');
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${unchainedUrl}/api/v1/account/${address}/txs`, {
          params: { pageSize: 10 },
          timeout: 10000,
        }),
      );

      const txs = response.data?.txs || [];

      return txs
        .filter((tx: Record<string, unknown>) => {
          // Filter for transactions with outputs to this address
          const vout = (tx.vout as Array<{ addresses: string[]; value: string }>) || [];
          return vout.some((output) =>
            output.addresses?.some((a) => a.toLowerCase() === address.toLowerCase()),
          );
        })
        .map((tx: Record<string, unknown>) => {
          const vout = (tx.vout as Array<{ addresses: string[]; value: string }>) || [];
          const receivedOutput = vout.find((output) =>
            output.addresses?.some((a) => a.toLowerCase() === address.toLowerCase()),
          );

          return {
            txHash: tx.txid as string,
            amount: receivedOutput?.value || '0',
            confirmations: (tx.confirmations as number) || 0,
            timestamp: (tx.timestamp as number) || 0,
          };
        });
    } catch {
      this.logger.debug(`No UTXO transactions found for ${address}`);
      return [];
    }
  }

  /**
   * Get Cosmos transactions for an address.
   * Queries Unchained Cosmos API for incoming transactions.
   *
   * @param address - The Cosmos address
   * @returns Array of incoming transactions
   */
  private async getCosmosTransactions(address: string): Promise<TransactionInfo[]> {
    let unchainedUrl: string | undefined;

    if (address.startsWith('cosmos')) {
      unchainedUrl = this.configService.get<string>('UNCHAINED_COSMOS_HTTP_URL');
    } else if (address.startsWith('osmo')) {
      unchainedUrl = this.configService.get<string>('UNCHAINED_OSMOSIS_HTTP_URL');
    }

    if (!unchainedUrl) {
      this.logger.debug('Unchained URL not configured for Cosmos address, skipping check');
      return [];
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${unchainedUrl}/api/v1/account/${address}/txs`, {
          params: { pageSize: 10 },
          timeout: 10000,
        }),
      );

      const txs = response.data?.txs || [];

      return txs
        .filter((tx: Record<string, unknown>) => {
          // Filter for incoming bank transfers
          const messages = (tx.messages as Array<{ type: string; to: string; value: { amount: string } }>) || [];
          return messages.some(
            (msg) =>
              msg.type === 'cosmos-sdk/MsgSend' &&
              msg.to?.toLowerCase() === address.toLowerCase(),
          );
        })
        .map((tx: Record<string, unknown>) => {
          const messages = (tx.messages as Array<{ type: string; to: string; value: { amount: string } }>) || [];
          const incomingMsg = messages.find(
            (msg) =>
              msg.type === 'cosmos-sdk/MsgSend' &&
              msg.to?.toLowerCase() === address.toLowerCase(),
          );

          return {
            txHash: tx.txid as string,
            amount: incomingMsg?.value?.amount || '0',
            confirmations: (tx.confirmations as number) || 1, // Cosmos has near-instant finality
            timestamp: (tx.timestamp as number) || 0,
          };
        });
    } catch {
      this.logger.debug(`No Cosmos transactions found for ${address}`);
      return [];
    }
  }

  /**
   * Get Solana transactions for an address.
   * Queries Solana RPC for incoming transactions.
   *
   * @param address - The Solana address
   * @returns Array of incoming transactions
   */
  private async getSolanaTransactions(address: string): Promise<TransactionInfo[]> {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL');

    if (!rpcUrl) {
      this.logger.debug('SOLANA_RPC_URL not configured, skipping Solana check');
      return [];
    }

    try {
      // Get recent signatures for the address
      const signaturesResponse = await firstValueFrom(
        this.httpService.post(
          rpcUrl,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignaturesForAddress',
            params: [address, { limit: 10 }],
          },
          { timeout: 10000 },
        ),
      );

      const signatures = signaturesResponse.data?.result || [];

      const transactions: TransactionInfo[] = [];

      for (const sig of signatures) {
        try {
          // Get transaction details
          const txResponse = await firstValueFrom(
            this.httpService.post(
              rpcUrl,
              {
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
              },
              { timeout: 10000 },
            ),
          );

          const tx = txResponse.data?.result;
          if (!tx) continue;

          // Check for incoming SOL transfers
          const preBalance = tx.meta?.preBalances?.[0] || 0;
          const postBalance = tx.meta?.postBalances?.[0] || 0;
          const receivedAmount = postBalance - preBalance;

          if (receivedAmount > 0) {
            transactions.push({
              txHash: sig.signature,
              amount: receivedAmount.toString(),
              confirmations: tx.slot ? 32 : 0, // Solana finality
              timestamp: tx.blockTime || 0,
            });
          }
        } catch {
          // Skip failed transaction fetches
          continue;
        }
      }

      return transactions;
    } catch {
      this.logger.debug(`No Solana transactions found for ${address}`);
      return [];
    }
  }
}
