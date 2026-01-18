import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Quote, QuoteStatus } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { SwapperType, SwapperName } from '../swappers/swapper.types';
import { isDirectSwapper, isServiceWalletSwapper } from '../swappers/swapper-config';

/**
 * Execution result returned by swap executors
 */
export interface SwapExecutionResult {
  success: boolean;
  executionTxHash?: string;
  error?: string;
  swapperName: string;
  swapperType: SwapperType;
  metadata?: Record<string, unknown>;
}

/**
 * Chainflip deposit channel status from API
 */
interface ChainflipChannelStatus {
  status: string;
  swapId?: string;
  depositAmount?: string;
  expectedOutputAmount?: string;
  outputTxHash?: string;
}

/**
 * NEAR Intents swap status from API
 */
interface NearIntentsSwapStatus {
  status: string;
  swapId?: string;
  outputTxHash?: string;
}

/**
 * SwapExecutorService handles the execution of swaps after deposits are detected.
 *
 * This service differentiates between two execution flows:
 *
 * 1. DIRECT swappers (Chainflip, NEAR Intents):
 *    - The deposit address belongs to the swapper's infrastructure
 *    - Swap execution happens automatically on their end
 *    - We only need to monitor the swap status
 *
 * 2. SERVICE_WALLET swappers (THORChain, Jupiter, etc.):
 *    - The deposit goes to our service wallet
 *    - We must initiate the swap transaction ourselves
 *    - Requires signing and broadcasting via the wallet manager
 */
@Injectable()
export class SwapExecutorService {
  private readonly logger = new Logger(SwapExecutorService.name);

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {}

  /**
   * Execute a swap for a quote that has received a deposit.
   *
   * Routes to the appropriate execution flow based on swapper type:
   * - DIRECT: Monitor swapper for completion (they handle execution)
   * - SERVICE_WALLET: Initiate and broadcast swap transaction
   *
   * @param quote - The quote with confirmed deposit
   * @returns Execution result with success status and tx hash
   */
  async executeSwap(quote: Quote): Promise<SwapExecutionResult> {
    const swapperName = quote.swapperName as SwapperName;
    const swapperType = quote.swapperType === 'DIRECT' ? SwapperType.DIRECT : SwapperType.SERVICE_WALLET;

    this.logger.log(
      `Executing swap for quote ${quote.quoteId} via ${swapperName} (${swapperType})`,
    );

    try {
      // Route to appropriate execution flow based on swapper type
      if (isDirectSwapper(swapperName)) {
        return this.executeDirectSwap(quote, swapperName);
      } else if (isServiceWalletSwapper(swapperName)) {
        return this.executeServiceWalletSwap(quote, swapperName);
      } else {
        // Unknown swapper - should not happen if validation is correct
        this.logger.error(`Unknown swapper type for ${swapperName}`);
        return {
          success: false,
          error: `Unsupported swapper: ${swapperName}`,
          swapperName,
          swapperType,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Swap execution failed for quote ${quote.quoteId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        error: errorMessage,
        swapperName,
        swapperType,
      };
    }
  }

  /**
   * Execute a swap using a DIRECT swapper.
   *
   * For DIRECT swappers (Chainflip, NEAR Intents), the swap execution
   * is handled by the swapper infrastructure. When a user deposits to
   * the swapper's deposit address, the swap is automatically initiated.
   *
   * Our responsibility is to:
   * 1. Check the swap status on the swapper's API
   * 2. Return the execution tx hash once complete
   *
   * @param quote - The quote with confirmed deposit
   * @param swapperName - The direct swapper name
   * @returns Execution result
   */
  private async executeDirectSwap(
    quote: Quote,
    swapperName: SwapperName,
  ): Promise<SwapExecutionResult> {
    this.logger.log(
      `DIRECT swap for quote ${quote.quoteId}: swapper ${swapperName} handles execution`,
    );

    switch (swapperName) {
      case SwapperName.Chainflip:
        return this.checkChainflipSwapStatus(quote);

      case SwapperName.NearIntents:
        return this.checkNearIntentsSwapStatus(quote);

      default:
        return {
          success: false,
          error: `Unsupported DIRECT swapper: ${swapperName}`,
          swapperName,
          swapperType: SwapperType.DIRECT,
        };
    }
  }

  /**
   * Check Chainflip swap status.
   *
   * Chainflip automatically executes swaps when deposits are received
   * at their deposit channel addresses. We query their status API to
   * get the output transaction hash.
   *
   * @param quote - The quote to check
   * @returns Execution result with status
   */
  private async checkChainflipSwapStatus(quote: Quote): Promise<SwapExecutionResult> {
    const chainflipApiUrl = this.configService.get<string>('CHAINFLIP_API_URL');

    if (!chainflipApiUrl) {
      this.logger.warn('CHAINFLIP_API_URL not configured');
      // For POC, return pending status
      return {
        success: false,
        error: 'Chainflip API URL not configured - swap may still be processing',
        swapperName: SwapperName.Chainflip,
        swapperType: SwapperType.DIRECT,
        metadata: { pendingExternalCheck: true },
      };
    }

    try {
      // Query Chainflip status endpoint using deposit channel/address
      // Note: In production, we'd track the deposit channel ID from quote creation
      const response = await firstValueFrom(
        this.httpService.get<ChainflipChannelStatus>(
          `${chainflipApiUrl}/swaps/status`,
          {
            params: {
              depositAddress: quote.depositAddress,
            },
            timeout: 15000,
          },
        ),
      );

      const status = response.data;

      if (status.status === 'complete' && status.outputTxHash) {
        this.logger.log(
          `Chainflip swap complete for quote ${quote.quoteId}: ${status.outputTxHash}`,
        );

        return {
          success: true,
          executionTxHash: status.outputTxHash,
          swapperName: SwapperName.Chainflip,
          swapperType: SwapperType.DIRECT,
          metadata: {
            swapId: status.swapId,
            depositAmount: status.depositAmount,
            outputAmount: status.expectedOutputAmount,
          },
        };
      }

      // Swap still in progress
      this.logger.debug(
        `Chainflip swap pending for quote ${quote.quoteId}: status=${status.status}`,
      );

      return {
        success: false,
        error: `Swap still processing: ${status.status}`,
        swapperName: SwapperName.Chainflip,
        swapperType: SwapperType.DIRECT,
        metadata: { status: status.status, swapId: status.swapId },
      };
    } catch (error) {
      this.logger.debug(
        `Could not check Chainflip status for quote ${quote.quoteId}`,
        error,
      );

      return {
        success: false,
        error: 'Unable to check Chainflip swap status',
        swapperName: SwapperName.Chainflip,
        swapperType: SwapperType.DIRECT,
        metadata: { pendingExternalCheck: true },
      };
    }
  }

  /**
   * Check NEAR Intents swap status.
   *
   * NEAR Intents executes swaps via their 1Click API when deposits
   * are received. We query their status endpoint for completion.
   *
   * @param quote - The quote to check
   * @returns Execution result with status
   */
  private async checkNearIntentsSwapStatus(quote: Quote): Promise<SwapExecutionResult> {
    const nearIntentsApiUrl = this.configService.get<string>('NEAR_INTENTS_API_URL');

    if (!nearIntentsApiUrl) {
      this.logger.warn('NEAR_INTENTS_API_URL not configured');
      return {
        success: false,
        error: 'NEAR Intents API URL not configured - swap may still be processing',
        swapperName: SwapperName.NearIntents,
        swapperType: SwapperType.DIRECT,
        metadata: { pendingExternalCheck: true },
      };
    }

    try {
      const jwtToken = this.configService.get<string>('NEAR_INTENTS_API_KEY');

      const response = await firstValueFrom(
        this.httpService.get<NearIntentsSwapStatus>(
          `${nearIntentsApiUrl}/swap/status`,
          {
            params: {
              depositAddress: quote.depositAddress,
            },
            headers: jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {},
            timeout: 15000,
          },
        ),
      );

      const status = response.data;

      if (status.status === 'complete' && status.outputTxHash) {
        this.logger.log(
          `NEAR Intents swap complete for quote ${quote.quoteId}: ${status.outputTxHash}`,
        );

        return {
          success: true,
          executionTxHash: status.outputTxHash,
          swapperName: SwapperName.NearIntents,
          swapperType: SwapperType.DIRECT,
          metadata: { swapId: status.swapId },
        };
      }

      return {
        success: false,
        error: `Swap still processing: ${status.status}`,
        swapperName: SwapperName.NearIntents,
        swapperType: SwapperType.DIRECT,
        metadata: { status: status.status, swapId: status.swapId },
      };
    } catch (error) {
      this.logger.debug(
        `Could not check NEAR Intents status for quote ${quote.quoteId}`,
        error,
      );

      return {
        success: false,
        error: 'Unable to check NEAR Intents swap status',
        swapperName: SwapperName.NearIntents,
        swapperType: SwapperType.DIRECT,
        metadata: { pendingExternalCheck: true },
      };
    }
  }

  /**
   * Execute a swap using a SERVICE_WALLET swapper.
   *
   * For SERVICE_WALLET swappers, we must:
   * 1. Build the swap transaction (memo, calldata, etc.)
   * 2. Sign it with our service wallet
   * 3. Broadcast to the network
   * 4. Return the execution tx hash
   *
   * @param quote - The quote with confirmed deposit
   * @param swapperName - The service wallet swapper name
   * @returns Execution result
   */
  private async executeServiceWalletSwap(
    quote: Quote,
    swapperName: SwapperName,
  ): Promise<SwapExecutionResult> {
    this.logger.log(
      `SERVICE_WALLET swap for quote ${quote.quoteId}: initiating ${swapperName} execution`,
    );

    switch (swapperName) {
      case SwapperName.THORChain:
        return this.executeThorChainSwap(quote);

      case SwapperName.Jupiter:
        return this.executeJupiterSwap(quote);

      case SwapperName.Relay:
        return this.executeRelaySwap(quote);

      case SwapperName.Mayachain:
        return this.executeMayachainSwap(quote);

      case SwapperName.ButterSwap:
        return this.executeButterSwapSwap(quote);

      case SwapperName.Bebop:
        return this.executeBebopSwap(quote);

      default:
        return {
          success: false,
          error: `Unsupported SERVICE_WALLET swapper: ${swapperName}`,
          swapperName,
          swapperType: SwapperType.SERVICE_WALLET,
        };
    }
  }

  /**
   * Execute a THORChain swap.
   *
   * THORChain uses memo-based routing. We need to:
   * 1. Get the inbound address from THORChain API
   * 2. Build a transaction with the swap memo
   * 3. Sign and broadcast
   *
   * Memo format: =:ASSET.ASSET:destination_address:limit
   */
  private async executeThorChainSwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Executing THORChain swap for quote ${quote.quoteId}`);

    // TODO: Implement THORChain swap execution
    // For POC, return placeholder indicating this needs implementation
    // In production:
    // 1. Query THORChain /thorchain/inbound_addresses for inbound vault
    // 2. Build transaction with swap memo
    // 3. Sign with wallet manager
    // 4. Broadcast to network
    // 5. Return tx hash

    return {
      success: false,
      error: 'THORChain swap execution not yet implemented',
      swapperName: SwapperName.THORChain,
      swapperType: SwapperType.SERVICE_WALLET,
      metadata: {
        receiveAddress: quote.receiveAddress,
        sellAmount: quote.sellAmountCryptoBaseUnit,
        needsImplementation: true,
      },
    };
  }

  /**
   * Execute a Jupiter swap (Solana only).
   *
   * Jupiter provides swap routes for Solana tokens.
   * We need to:
   * 1. Get swap route from Jupiter API
   * 2. Build and sign the Solana transaction
   * 3. Broadcast to Solana network
   */
  private async executeJupiterSwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Executing Jupiter swap for quote ${quote.quoteId}`);

    // TODO: Implement Jupiter swap execution
    // For POC, return placeholder

    return {
      success: false,
      error: 'Jupiter swap execution not yet implemented',
      swapperName: SwapperName.Jupiter,
      swapperType: SwapperType.SERVICE_WALLET,
      metadata: {
        receiveAddress: quote.receiveAddress,
        sellAmount: quote.sellAmountCryptoBaseUnit,
        needsImplementation: true,
      },
    };
  }

  /**
   * Execute a Relay swap (cross-chain bridging).
   */
  private async executeRelaySwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Executing Relay swap for quote ${quote.quoteId}`);

    // TODO: Implement Relay swap execution

    return {
      success: false,
      error: 'Relay swap execution not yet implemented',
      swapperName: SwapperName.Relay,
      swapperType: SwapperType.SERVICE_WALLET,
      metadata: {
        receiveAddress: quote.receiveAddress,
        sellAmount: quote.sellAmountCryptoBaseUnit,
        needsImplementation: true,
      },
    };
  }

  /**
   * Execute a Mayachain swap.
   *
   * Similar to THORChain, uses memo-based routing.
   */
  private async executeMayachainSwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Executing Mayachain swap for quote ${quote.quoteId}`);

    // TODO: Implement Mayachain swap execution

    return {
      success: false,
      error: 'Mayachain swap execution not yet implemented',
      swapperName: SwapperName.Mayachain,
      swapperType: SwapperType.SERVICE_WALLET,
      metadata: {
        receiveAddress: quote.receiveAddress,
        sellAmount: quote.sellAmountCryptoBaseUnit,
        needsImplementation: true,
      },
    };
  }

  /**
   * Execute a ButterSwap swap.
   */
  private async executeButterSwapSwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Executing ButterSwap swap for quote ${quote.quoteId}`);

    // TODO: Implement ButterSwap swap execution

    return {
      success: false,
      error: 'ButterSwap swap execution not yet implemented',
      swapperName: SwapperName.ButterSwap,
      swapperType: SwapperType.SERVICE_WALLET,
      metadata: {
        receiveAddress: quote.receiveAddress,
        sellAmount: quote.sellAmountCryptoBaseUnit,
        needsImplementation: true,
      },
    };
  }

  /**
   * Execute a Bebop swap (intent-based).
   */
  private async executeBebopSwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Executing Bebop swap for quote ${quote.quoteId}`);

    // TODO: Implement Bebop swap execution

    return {
      success: false,
      error: 'Bebop swap execution not yet implemented',
      swapperName: SwapperName.Bebop,
      swapperType: SwapperType.SERVICE_WALLET,
      metadata: {
        receiveAddress: quote.receiveAddress,
        sellAmount: quote.sellAmountCryptoBaseUnit,
        needsImplementation: true,
      },
    };
  }

  /**
   * Check if a swap is still pending execution.
   *
   * For DIRECT swappers, this queries the swapper's status API.
   * For SERVICE_WALLET swappers, this checks the blockchain for tx confirmation.
   *
   * @param quote - The quote to check
   * @returns True if swap is still pending
   */
  async isSwapPending(quote: Quote): Promise<boolean> {
    // If quote already has execution tx hash, it's not pending
    if (quote.executionTxHash) {
      return false;
    }

    // If quote status indicates completion or failure, it's not pending
    if (
      quote.status === QuoteStatus.COMPLETED ||
      quote.status === QuoteStatus.FAILED ||
      quote.status === QuoteStatus.EXPIRED
    ) {
      return false;
    }

    // Quote is still pending
    return true;
  }

  /**
   * Retry a failed swap execution.
   *
   * @param quote - The quote to retry
   * @returns Execution result from retry attempt
   */
  async retrySwap(quote: Quote): Promise<SwapExecutionResult> {
    this.logger.log(`Retrying swap execution for quote ${quote.quoteId}`);
    return this.executeSwap(quote);
  }
}
