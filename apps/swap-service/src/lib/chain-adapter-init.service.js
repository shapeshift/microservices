"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ChainAdapterInitService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChainAdapterInitService = void 0;
const common_1 = require("@nestjs/common");
const chain_adapter_manager_service_1 = require("./chain-adapter-manager.service");
const evm_service_1 = require("./chain-adapters/evm.service");
const utxo_service_1 = require("./chain-adapters/utxo.service");
const cosmos_sdk_service_1 = require("./chain-adapters/cosmos-sdk.service");
const solana_service_1 = require("./chain-adapters/solana.service");
let ChainAdapterInitService = ChainAdapterInitService_1 = class ChainAdapterInitService {
    constructor(chainAdapterManagerService, evmChainAdapterService, utxoChainAdapterService, cosmosSdkChainAdapterService, solanaChainAdapterService) {
        this.chainAdapterManagerService = chainAdapterManagerService;
        this.evmChainAdapterService = evmChainAdapterService;
        this.utxoChainAdapterService = utxoChainAdapterService;
        this.cosmosSdkChainAdapterService = cosmosSdkChainAdapterService;
        this.solanaChainAdapterService = solanaChainAdapterService;
        this.logger = new common_1.Logger(ChainAdapterInitService_1.name);
    }
    initializeChainAdapters() {
        this.logger.log('Initializing chain adapters...');
        try {
            this.evmChainAdapterService.initializeEvmChainAdapters();
            this.utxoChainAdapterService.initializeUtxoChainAdapters();
            this.cosmosSdkChainAdapterService.initializeCosmosSdkChainAdapters();
            this.solanaChainAdapterService.initializeSolanaChainAdapter();
            this.logger.log('All chain adapters initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize chain adapters:', error);
            throw error;
        }
    }
    getChainAdapterManager() {
        return this.chainAdapterManagerService.getChainAdapterManager();
    }
};
exports.ChainAdapterInitService = ChainAdapterInitService;
exports.ChainAdapterInitService = ChainAdapterInitService = ChainAdapterInitService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [chain_adapter_manager_service_1.ChainAdapterManagerService,
        evm_service_1.EvmChainAdapterService,
        utxo_service_1.UtxoChainAdapterService,
        cosmos_sdk_service_1.CosmosSdkChainAdapterService,
        solana_service_1.SolanaChainAdapterService])
], ChainAdapterInitService);
