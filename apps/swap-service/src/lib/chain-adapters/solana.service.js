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
var SolanaChainAdapterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaChainAdapterService = void 0;
const common_1 = require("@nestjs/common");
const chain_adapter_manager_service_1 = require("../chain-adapter-manager.service");
const unchained = __importStar(require("@shapeshiftoss/unchained-client"));
const chain_adapters_1 = require("@shapeshiftoss/chain-adapters");
const caip_1 = require("@shapeshiftoss/caip");
let SolanaChainAdapterService = SolanaChainAdapterService_1 = class SolanaChainAdapterService {
    constructor(chainAdapterManagerService) {
        this.chainAdapterManagerService = chainAdapterManagerService;
        this.logger = new common_1.Logger(SolanaChainAdapterService_1.name);
    }
    initializeSolanaChainAdapter() {
        this.logger.log('Initializing Solana chain adapter...');
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        try {
            this.initializeSolanaAdapter(chainAdapterManager);
            this.logger.log('Solana chain adapter initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize Solana chain adapter:', error);
            throw error;
        }
    }
    initializeSolanaAdapter(chainAdapterManager) {
        const solanaHttp = new unchained.solana.V1Api(new unchained.solana.Configuration({
            basePath: process.env.VITE_UNCHAINED_SOLANA_HTTP_URL,
        }));
        const solanaWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_SOLANA_WS_URL);
        const solanaAdapter = new chain_adapters_1.solana.ChainAdapter({
            providers: { http: solanaHttp, ws: solanaWs },
            rpcUrl: process.env.VITE_SOLANA_NODE_URL,
        });
        chainAdapterManager.set(caip_1.solanaChainId, solanaAdapter);
        this.logger.log('Solana adapter initialized');
    }
    assertGetSolanaChainAdapter(chainId) {
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        const adapter = chainAdapterManager.get(chainId);
        if (!adapter) {
            throw new Error(`Solana chain adapter not found for chain ${chainId}`);
        }
        return adapter;
    }
};
exports.SolanaChainAdapterService = SolanaChainAdapterService;
exports.SolanaChainAdapterService = SolanaChainAdapterService = SolanaChainAdapterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [chain_adapter_manager_service_1.ChainAdapterManagerService])
], SolanaChainAdapterService);
