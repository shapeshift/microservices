import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keyring,
  bip32ToAddressNList,
  slip44ByCoin,
  ETHGetAddress,
  BTCGetAddress,
  BTCInputScriptType,
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
 * Supported UTXO chains and their identifiers.
 * Each UTXO chain has its own SLIP44 coin type and address format.
 */
export type UtxoChain = 'BTC' | 'LTC' | 'DOGE' | 'BCH';

/**
 * UTXO address result with metadata
 */
export interface UtxoAddressResult {
  address: string;
  chain: UtxoChain;
  derivationPath: string;
  accountIndex: number;
  scriptType: BTCInputScriptType;
}

/**
 * UTXO chain configuration including SLIP44 coin type and preferred script type.
 * - BTC/LTC: Use SegWit (P2WPKH) with BIP84 derivation for modern address format
 * - DOGE/BCH: Use Legacy (P2PKH) with BIP44 derivation as they don't support SegWit
 */
const UTXO_CHAIN_CONFIG: Record<
  UtxoChain,
  { coinName: string; scriptType: BTCInputScriptType; purpose: number }
> = {
  BTC: {
    coinName: 'Bitcoin',
    scriptType: BTCInputScriptType.SpendWitness, // Native SegWit (bech32)
    purpose: 84, // BIP84 for native SegWit
  },
  LTC: {
    coinName: 'Litecoin',
    scriptType: BTCInputScriptType.SpendWitness, // Native SegWit (bech32)
    purpose: 84, // BIP84 for native SegWit
  },
  DOGE: {
    coinName: 'Dogecoin',
    scriptType: BTCInputScriptType.SpendAddress, // Legacy P2PKH
    purpose: 44, // BIP44 for legacy
  },
  BCH: {
    coinName: 'BitcoinCash',
    scriptType: BTCInputScriptType.SpendAddress, // Legacy P2PKH
    purpose: 44, // BIP44 for legacy
  },
};

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

  /**
   * Get the BIP32 derivation path for UTXO chains.
   * - BIP84 (m/84'/coin'/account'/0/index) for SegWit chains (BTC, LTC)
   * - BIP44 (m/44'/coin'/account'/0/index) for legacy chains (DOGE, BCH)
   *
   * @param chain - The UTXO chain
   * @param accountIndex - Account index (default: 0)
   * @param addressIndex - Address index within the account (default: 0)
   * @returns The derivation path string
   */
  private getUtxoDerivationPath(
    chain: UtxoChain,
    accountIndex = 0,
    addressIndex = 0,
  ): string {
    const config = UTXO_CHAIN_CONFIG[chain];
    const coinType = slip44ByCoin(config.coinName);
    return `m/${config.purpose}'/${coinType}'/${accountIndex}'/0/${addressIndex}`;
  }

  /**
   * Generate a UTXO-chain wallet address for deposit purposes.
   * Each UTXO chain uses its own SLIP44 coin type and may use different
   * address formats (SegWit for BTC/LTC, Legacy for DOGE/BCH).
   *
   * @param chain - The UTXO chain identifier
   * @param accountIndex - Account index for address derivation (default: 0)
   * @param addressIndex - Address index within the account (default: 0)
   * @returns The generated address with metadata
   * @throws Error if wallet is not initialized
   */
  async getUtxoAddress(
    chain: UtxoChain,
    accountIndex = 0,
    addressIndex = 0,
  ): Promise<UtxoAddressResult> {
    const wallet = this.getWallet();
    const config = UTXO_CHAIN_CONFIG[chain];
    const derivationPath = this.getUtxoDerivationPath(chain, accountIndex, addressIndex);

    this.logger.debug(`Generating ${chain} address at path: ${derivationPath}`);

    const addressNList = bip32ToAddressNList(derivationPath);

    const params: BTCGetAddress = {
      addressNList,
      coin: config.coinName,
      scriptType: config.scriptType,
      showDisplay: false, // Don't require user confirmation (server-side)
    };

    const address = await wallet.btcGetAddress(params);

    if (!address) {
      throw new Error(`Failed to generate ${chain} address at path ${derivationPath}`);
    }

    return {
      address,
      chain,
      derivationPath,
      accountIndex,
      scriptType: config.scriptType,
    };
  }

  /**
   * Generate deposit addresses for all supported UTXO chains.
   * Useful for initializing deposit addresses at startup.
   *
   * @param accountIndex - Account index for address derivation (default: 0)
   * @returns Array of addresses for all UTXO chains
   */
  async getAllUtxoAddresses(accountIndex = 0): Promise<UtxoAddressResult[]> {
    const utxoChains: UtxoChain[] = ['BTC', 'LTC', 'DOGE', 'BCH'];

    const addresses: UtxoAddressResult[] = [];

    for (const chain of utxoChains) {
      try {
        const result = await this.getUtxoAddress(chain, accountIndex);
        addresses.push(result);
        this.logger.debug(`Generated ${chain} address: ${result.address}`);
      } catch (error) {
        this.logger.error(`Failed to generate address for ${chain}:`, error);
        throw error;
      }
    }

    this.logger.log(
      `Generated UTXO deposit addresses: BTC=${addresses[0]?.address}, LTC=${addresses[1]?.address}, DOGE=${addresses[2]?.address}, BCH=${addresses[3]?.address}`,
    );

    return addresses;
  }

  /**
   * Get UTXO address for a specific quote.
   * Uses addressIndex to generate unique deposit addresses per quote.
   *
   * @param chain - The UTXO chain
   * @param quoteIndex - Index to derive unique address for this quote
   * @returns The generated address
   */
  async getUtxoDepositAddress(chain: UtxoChain, quoteIndex: number): Promise<string> {
    const result = await this.getUtxoAddress(chain, 0, quoteIndex);
    return result.address;
  }
}
