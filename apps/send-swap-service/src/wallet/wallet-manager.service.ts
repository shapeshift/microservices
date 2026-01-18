import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keyring } from '@shapeshiftoss/hdwallet-core';
import { NativeHDWallet, NativeAdapter } from '@shapeshiftoss/hdwallet-native';

/**
 * WalletManagerService manages the HD wallet for all supported chains.
 * It initializes a native HD wallet from a mnemonic stored in environment variables
 * and provides access to the wallet for address generation and signing.
 */
@Injectable()
export class WalletManagerService implements OnModuleInit {
  private readonly logger = new Logger(WalletManagerService.name);
  private keyring: Keyring;
  private wallet: NativeHDWallet | null = null;
  private initialized = false;

  constructor(private configService: ConfigService) {
    this.keyring = new Keyring();
  }

  async onModuleInit() {
    await this.initializeWallet();
  }

  /**
   * Initialize the HD wallet from the mnemonic stored in environment variables.
   * This must be called before any wallet operations.
   */
  async initializeWallet(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Wallet already initialized');
      return;
    }

    this.logger.log('Initializing HD wallet...');

    try {
      const mnemonic = this.configService.get<string>('MNEMONIC');
      const passphrase = this.configService.get<string>('WALLET_PASSPHRASE') || '';

      if (!mnemonic) {
        throw new Error('MNEMONIC environment variable is not set');
      }

      // Create native adapter for the keyring
      const nativeAdapter = NativeAdapter.useKeyring(this.keyring);
      await nativeAdapter.initialize();

      // Create and load the wallet with the mnemonic
      const wallet = await nativeAdapter.pairDevice();
      if (!wallet) {
        throw new Error('Failed to pair native wallet device');
      }

      // Load the mnemonic into the wallet
      await wallet.loadDevice({
        mnemonic,
        passphrase,
      });

      this.wallet = wallet;
      this.initialized = true;

      // Log success without exposing sensitive data
      const walletId = await wallet.getDeviceID();
      this.logger.log(`HD wallet initialized successfully (device: ${walletId})`);
    } catch (error) {
      this.logger.error('Failed to initialize HD wallet:', error);
      throw error;
    }
  }

  /**
   * Get the initialized HD wallet instance.
   * @throws Error if wallet is not initialized
   */
  getWallet(): NativeHDWallet {
    if (!this.wallet || !this.initialized) {
      throw new Error('Wallet not initialized. Call initializeWallet() first.');
    }
    return this.wallet;
  }

  /**
   * Get the keyring instance for managing wallet connections.
   */
  getKeyring(): Keyring {
    return this.keyring;
  }

  /**
   * Check if the wallet is initialized and ready for use.
   */
  isInitialized(): boolean {
    return this.initialized && this.wallet !== null;
  }
}
