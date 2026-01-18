import { Injectable, Logger } from '@nestjs/common';
import { WalletManagerService } from './wallet-manager.service';

/**
 * WalletInitService handles explicit wallet initialization at startup.
 * This service should be called from main.ts before starting the HTTP listener
 * to ensure all wallets are ready to generate deposit addresses.
 */
@Injectable()
export class WalletInitService {
  private readonly logger = new Logger(WalletInitService.name);

  constructor(private walletManagerService: WalletManagerService) {}

  /**
   * Initialize all wallet services and verify they are ready for use.
   * This method should be called from main.ts before app.listen().
   *
   * The initialization process:
   * 1. Ensures the HD wallet is initialized from the mnemonic
   * 2. Verifies wallet can generate addresses for all supported chains
   * 3. Logs the primary deposit addresses for each chain type
   */
  async initializeWallets(): Promise<void> {
    this.logger.log('Initializing wallets...');

    try {
      // Ensure wallet is initialized (may already be done via OnModuleInit)
      await this.walletManagerService.initializeWallet();

      // Verify wallet is ready by checking initialization status
      if (!this.walletManagerService.isInitialized()) {
        throw new Error('Wallet initialization failed - wallet not ready');
      }

      // Generate and log primary deposit addresses for verification
      await this.verifyAddressGeneration();

      this.logger.log('All wallets initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize wallets:', error);
      throw error;
    }
  }

  /**
   * Verify wallet can generate addresses for all supported chain types.
   * This is a startup health check to ensure the wallet is properly configured.
   */
  private async verifyAddressGeneration(): Promise<void> {
    this.logger.log('Verifying address generation for all chain types...');

    try {
      // Verify EVM address generation
      const evmAddress = await this.walletManagerService.getEvmAddress('ETH', 0, 0);
      this.logger.log(`EVM deposit address: ${evmAddress.address}`);

      // Verify UTXO address generation (BTC as primary)
      const btcAddress = await this.walletManagerService.getUtxoAddress('BTC', 0, 0);
      this.logger.log(`BTC deposit address: ${btcAddress.address}`);

      // Verify Cosmos address generation (ATOM as primary)
      const atomAddress = await this.walletManagerService.getCosmosAddress('ATOM', 0, 0);
      this.logger.log(`ATOM deposit address: ${atomAddress.address}`);

      // Verify Solana address generation
      const solanaAddress = await this.walletManagerService.getSolanaAddress(0);
      this.logger.log(`Solana deposit address: ${solanaAddress.address}`);

      this.logger.log('Address generation verified for all chain types');
    } catch (error) {
      this.logger.error('Address generation verification failed:', error);
      throw error;
    }
  }

  /**
   * Get the wallet manager service instance.
   */
  getWalletManager(): WalletManagerService {
    return this.walletManagerService;
  }
}
