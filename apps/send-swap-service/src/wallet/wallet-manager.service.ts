import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keyring,
  bip32ToAddressNList,
  slip44ByCoin,
  ETHGetAddress,
} from '@shapeshiftoss/hdwallet-core';
import { NativeHDWallet, NativeAdapter } from '@shapeshiftoss/hdwallet-native';

/**
 * Supported EVM chains and their identifiers.
 * All EVM chains use the same SLIP44 coin type (60) since they share the same
 * address derivation scheme.
 */
export type EvmChain = 'ETH' | 'AVAX' | 'BSC' | 'POLYGON' | 'OPTIMISM' | 'ARBITRUM' | 'BASE' | 'GNOSIS';

/**
 * EVM address result with metadata
 */
export interface EvmAddressResult {
  address: string;
  chain: EvmChain;
  derivationPath: string;
  accountIndex: number;
}

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

  /**
   * Get the BIP44 derivation path for EVM chains.
   * Standard path format: m/44'/60'/account'/0/addressIndex
   * All EVM chains use coin type 60 (ETH) as they share the same address format.
   *
   * @param accountIndex - Account index (default: 0)
   * @param addressIndex - Address index within the account (default: 0)
   * @returns The derivation path string
   */
  private getEvmDerivationPath(accountIndex = 0, addressIndex = 0): string {
    const coinType = slip44ByCoin('ETH'); // 60 for all EVM chains
    return `m/44'/${coinType}'/${accountIndex}'/0/${addressIndex}`;
  }

  /**
   * Generate an EVM-compatible wallet address for deposit purposes.
   * All EVM chains (ETH, AVAX, BSC, Polygon, etc.) use the same address derivation
   * since they're Ethereum-compatible and share the 0x address format.
   *
   * @param chain - The EVM chain identifier (for metadata purposes)
   * @param accountIndex - Account index for address derivation (default: 0)
   * @param addressIndex - Address index within the account (default: 0)
   * @returns The generated address with metadata
   * @throws Error if wallet is not initialized
   */
  async getEvmAddress(
    chain: EvmChain = 'ETH',
    accountIndex = 0,
    addressIndex = 0,
  ): Promise<EvmAddressResult> {
    const wallet = this.getWallet();
    const derivationPath = this.getEvmDerivationPath(accountIndex, addressIndex);

    this.logger.debug(`Generating ${chain} address at path: ${derivationPath}`);

    const addressNList = bip32ToAddressNList(derivationPath);

    const params: ETHGetAddress = {
      addressNList,
      showDisplay: false, // Don't require user confirmation (server-side)
    };

    const address = await wallet.ethGetAddress(params);

    if (!address) {
      throw new Error(`Failed to generate ${chain} address at path ${derivationPath}`);
    }

    return {
      address,
      chain,
      derivationPath,
      accountIndex,
    };
  }

  /**
   * Generate deposit addresses for all supported EVM chains.
   * Useful for initializing deposit addresses at startup.
   *
   * @param accountIndex - Account index for address derivation (default: 0)
   * @returns Array of addresses for all EVM chains
   */
  async getAllEvmAddresses(accountIndex = 0): Promise<EvmAddressResult[]> {
    const evmChains: EvmChain[] = [
      'ETH',
      'AVAX',
      'BSC',
      'POLYGON',
      'OPTIMISM',
      'ARBITRUM',
      'BASE',
      'GNOSIS',
    ];

    const addresses: EvmAddressResult[] = [];

    for (const chain of evmChains) {
      try {
        const result = await this.getEvmAddress(chain, accountIndex);
        addresses.push(result);
        this.logger.debug(`Generated ${chain} address: ${result.address}`);
      } catch (error) {
        this.logger.error(`Failed to generate address for ${chain}:`, error);
        throw error;
      }
    }

    // All EVM addresses should be identical since they use the same derivation
    const uniqueAddresses = new Set(addresses.map((a) => a.address));
    if (uniqueAddresses.size === 1) {
      this.logger.log(
        `Generated EVM deposit address for ${evmChains.length} chains: ${addresses[0].address}`,
      );
    }

    return addresses;
  }

  /**
   * Get EVM address for a specific quote.
   * Uses addressIndex to generate unique deposit addresses per quote.
   *
   * @param chain - The EVM chain
   * @param quoteIndex - Index to derive unique address for this quote
   * @returns The generated address
   */
  async getEvmDepositAddress(chain: EvmChain, quoteIndex: number): Promise<string> {
    const result = await this.getEvmAddress(chain, 0, quoteIndex);
    return result.address;
  }
}
