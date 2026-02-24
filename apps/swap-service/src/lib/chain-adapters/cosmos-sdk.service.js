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
var CosmosSdkChainAdapterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosSdkChainAdapterService = void 0;
const common_1 = require("@nestjs/common");
const chain_adapter_manager_service_1 = require("../chain-adapter-manager.service");
const unchained = __importStar(require("@shapeshiftoss/unchained-client"));
const chain_adapters_1 = require("@shapeshiftoss/chain-adapters");
const caip_1 = require("@shapeshiftoss/caip");
const chain_adapters_2 = require("@shapeshiftoss/chain-adapters");
let CosmosSdkChainAdapterService = CosmosSdkChainAdapterService_1 = class CosmosSdkChainAdapterService {
    constructor(chainAdapterManagerService) {
        this.chainAdapterManagerService = chainAdapterManagerService;
        this.logger = new common_1.Logger(CosmosSdkChainAdapterService_1.name);
    }
    initializeCosmosSdkChainAdapters() {
        this.logger.log('Initializing Cosmos SDK chain adapters...');
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        try {
            this.initializeCosmosAdapter(chainAdapterManager);
            this.initializeThorchainAdapter(chainAdapterManager);
            this.initializeMayachainAdapter(chainAdapterManager);
            this.logger.log('All Cosmos SDK chain adapters initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize Cosmos SDK chain adapters:', error);
            throw error;
        }
    }
    initializeCosmosAdapter(chainAdapterManager) {
        const cosmosHttp = new unchained.cosmos.V1Api(new unchained.cosmos.Configuration({
            basePath: process.env.VITE_UNCHAINED_COSMOS_HTTP_URL,
        }));
        const cosmosWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_COSMOS_WS_URL);
        const cosmosAdapter = new chain_adapters_1.cosmos.ChainAdapter({
            providers: { http: cosmosHttp, ws: cosmosWs },
            midgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            coinName: 'Cosmos',
        });
        chainAdapterManager.set(caip_1.cosmosChainId, cosmosAdapter);
        this.logger.log('Cosmos adapter initialized');
    }
    initializeThorchainAdapter(chainAdapterManager) {
        const http = new unchained.thorchain.V1Api(new unchained.thorchain.Configuration({
            basePath: process.env.VITE_UNCHAINED_THORCHAIN_HTTP_URL,
        }));
        const httpV1 = new unchained.thorchainV1.V1Api(new unchained.thorchainV1.Configuration({
            basePath: process.env.VITE_UNCHAINED_THORCHAIN_V1_HTTP_URL,
        }));
        const ws = new unchained.ws.Client(process.env.VITE_UNCHAINED_THORCHAIN_WS_URL);
        const thorchainAdapter = new chain_adapters_1.thorchain.ChainAdapter({
            providers: { http, ws },
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
            coinName: 'THOR',
            httpV1,
        });
        chainAdapterManager.set(caip_1.thorchainChainId, thorchainAdapter);
        this.logger.log('Thorchain adapter initialized');
    }
    initializeMayachainAdapter(chainAdapterManager) {
        const mayachainHttp = new unchained.mayachain.V1Api(new unchained.mayachain.Configuration({
            basePath: process.env.VITE_UNCHAINED_MAYACHAIN_HTTP_URL,
        }));
        const mayachainWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_MAYACHAIN_WS_URL);
        const mayachainAdapter = new chain_adapters_1.mayachain.ChainAdapter({
            providers: { http: mayachainHttp, ws: mayachainWs },
            midgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
            coinName: 'MAYA',
        });
        chainAdapterManager.set(caip_1.mayachainChainId, mayachainAdapter);
        this.logger.log('Mayachain adapter initialized');
    }
    assertGetCosmosSdkChainAdapter(chainId) {
        if (!chain_adapters_2.cosmosSdkChainIds.includes(chainId)) {
            throw new Error(`Chain ${chainId} is not a Cosmos SDK chain`);
        }
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        const adapter = chainAdapterManager.get(chainId);
        if (!adapter) {
            throw new Error(`Cosmos SDK chain adapter not found for chain ${chainId}`);
        }
        return adapter;
    }
};
exports.CosmosSdkChainAdapterService = CosmosSdkChainAdapterService;
exports.CosmosSdkChainAdapterService = CosmosSdkChainAdapterService = CosmosSdkChainAdapterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [chain_adapter_manager_service_1.ChainAdapterManagerService])
], CosmosSdkChainAdapterService);
