"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UtxoChainAdapterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UtxoChainAdapterService = void 0;
const common_1 = require("@nestjs/common");
const chain_adapter_manager_service_1 = require("../chain-adapter-manager.service");
const unchained = __importStar(require("@shapeshiftoss/unchained-client"));
const chain_adapters_1 = require("@shapeshiftoss/chain-adapters");
const caip_1 = require("@shapeshiftoss/caip");
const chain_adapters_2 = require("@shapeshiftoss/chain-adapters");
let UtxoChainAdapterService = UtxoChainAdapterService_1 = class UtxoChainAdapterService {
    constructor(chainAdapterManagerService) {
        this.chainAdapterManagerService = chainAdapterManagerService;
        this.logger = new common_1.Logger(UtxoChainAdapterService_1.name);
    }
    async initializeUtxoChainAdapters() {
        this.logger.log('Initializing UTXO chain adapters...');
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        try {
            await this.initializeBitcoinAdapter(chainAdapterManager);
            await this.initializeBitcoinCashAdapter(chainAdapterManager);
            await this.initializeDogecoinAdapter(chainAdapterManager);
            await this.initializeLitecoinAdapter(chainAdapterManager);
            this.logger.log('All UTXO chain adapters initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize UTXO chain adapters:', error);
            throw error;
        }
    }
    async initializeBitcoinAdapter(chainAdapterManager) {
        const bitcoinHttp = new unchained.bitcoin.V1Api(new unchained.bitcoin.Configuration({
            basePath: process.env.VITE_UNCHAINED_BITCOIN_HTTP_URL,
        }));
        const bitcoinWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_BITCOIN_WS_URL);
        const bitcoinAdapter = new chain_adapters_1.bitcoin.ChainAdapter({
            providers: { http: bitcoinHttp, ws: bitcoinWs },
            coinName: 'Bitcoin',
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.btcChainId, bitcoinAdapter);
        this.logger.log('Bitcoin adapter initialized');
    }
    async initializeBitcoinCashAdapter(chainAdapterManager) {
        const bchHttp = new unchained.bitcoin.V1Api(new unchained.bitcoin.Configuration({
            basePath: process.env.VITE_UNCHAINED_BITCOINCASH_HTTP_URL,
        }));
        const bchWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_BITCOINCASH_WS_URL);
        const bchAdapter = new chain_adapters_1.bitcoin.ChainAdapter({
            providers: { http: bchHttp, ws: bchWs },
            coinName: 'BitcoinCash',
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.bchChainId, bchAdapter);
        this.logger.log('Bitcoin Cash adapter initialized');
    }
    async initializeDogecoinAdapter(chainAdapterManager) {
        const dogeHttp = new unchained.bitcoin.V1Api(new unchained.bitcoin.Configuration({
            basePath: process.env.VITE_UNCHAINED_DOGECOIN_HTTP_URL,
        }));
        const dogeWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_DOGECOIN_WS_URL);
        const dogeAdapter = new chain_adapters_1.bitcoin.ChainAdapter({
            providers: { http: dogeHttp, ws: dogeWs },
            coinName: 'Dogecoin',
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.dogeChainId, dogeAdapter);
        this.logger.log('Dogecoin adapter initialized');
    }
    async initializeLitecoinAdapter(chainAdapterManager) {
        const ltcHttp = new unchained.bitcoin.V1Api(new unchained.bitcoin.Configuration({
            basePath: process.env.VITE_UNCHAINED_LITECOIN_HTTP_URL,
        }));
        const ltcWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_LITECOIN_WS_URL);
        const ltcAdapter = new chain_adapters_1.bitcoin.ChainAdapter({
            providers: { http: ltcHttp, ws: ltcWs },
            coinName: 'Litecoin',
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.ltcChainId, ltcAdapter);
        this.logger.log('Litecoin adapter initialized');
    }
    assertGetUtxoChainAdapter(chainId) {
        if (!chain_adapters_2.utxoChainIds.includes(chainId)) {
            throw new Error(`Chain ${chainId} is not a UTXO chain`);
        }
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        const adapter = chainAdapterManager.get(chainId);
        if (!adapter) {
            throw new Error(`UTXO chain adapter not found for chain ${chainId}`);
        }
        return adapter;
    }
};
exports.UtxoChainAdapterService = UtxoChainAdapterService;
exports.UtxoChainAdapterService = UtxoChainAdapterService = UtxoChainAdapterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [chain_adapter_manager_service_1.ChainAdapterManagerService])
], UtxoChainAdapterService);
