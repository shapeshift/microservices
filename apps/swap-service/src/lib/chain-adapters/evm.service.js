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
var EvmChainAdapterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvmChainAdapterService = void 0;
const common_1 = require("@nestjs/common");
const chain_adapter_manager_service_1 = require("../chain-adapter-manager.service");
const unchained = __importStar(require("@shapeshiftoss/unchained-client"));
const chain_adapters_1 = require("@shapeshiftoss/chain-adapters");
const caip_1 = require("@shapeshiftoss/caip");
const chain_adapters_2 = require("@shapeshiftoss/chain-adapters");
let EvmChainAdapterService = EvmChainAdapterService_1 = class EvmChainAdapterService {
    constructor(chainAdapterManagerService) {
        this.chainAdapterManagerService = chainAdapterManagerService;
        this.logger = new common_1.Logger(EvmChainAdapterService_1.name);
    }
    async initializeEvmChainAdapters() {
        this.logger.log('Initializing EVM chain adapters...');
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        try {
            await this.initializeEthereumAdapter(chainAdapterManager);
            await this.initializeAvalancheAdapter(chainAdapterManager);
            await this.initializeOptimismAdapter(chainAdapterManager);
            await this.initializeBscAdapter(chainAdapterManager);
            await this.initializePolygonAdapter(chainAdapterManager);
            await this.initializeGnosisAdapter(chainAdapterManager);
            await this.initializeArbitrumAdapter(chainAdapterManager);
            await this.initializeArbitrumNovaAdapter(chainAdapterManager);
            await this.initializeBaseAdapter(chainAdapterManager);
            this.logger.log('All EVM chain adapters initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize EVM chain adapters:', error);
            throw error;
        }
    }
    async initializeEthereumAdapter(chainAdapterManager) {
        const ethereumHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_ETHEREUM_HTTP_URL,
        }));
        const ethereumWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_ETHEREUM_WS_URL);
        const ethereumAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: ethereumHttp, ws: ethereumWs },
            rpcUrl: process.env.VITE_ETHEREUM_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.ethChainId, ethereumAdapter);
        this.logger.log('Ethereum adapter initialized');
    }
    async initializeAvalancheAdapter(chainAdapterManager) {
        const avalancheHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_AVALANCHE_HTTP_URL,
        }));
        const avalancheWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_AVALANCHE_WS_URL);
        const avalancheAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: avalancheHttp, ws: avalancheWs },
            rpcUrl: process.env.VITE_AVALANCHE_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.avalancheChainId, avalancheAdapter);
        this.logger.log('Avalanche adapter initialized');
    }
    async initializeOptimismAdapter(chainAdapterManager) {
        const optimismHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_OPTIMISM_HTTP_URL,
        }));
        const optimismWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_OPTIMISM_WS_URL);
        const optimismAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: optimismHttp, ws: optimismWs },
            rpcUrl: process.env.VITE_OPTIMISM_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.optimismChainId, optimismAdapter);
        this.logger.log('Optimism adapter initialized');
    }
    async initializeBscAdapter(chainAdapterManager) {
        const bscHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_BNBSMARTCHAIN_HTTP_URL,
        }));
        const bscWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_BNBSMARTCHAIN_WS_URL);
        const bscAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: bscHttp, ws: bscWs },
            rpcUrl: process.env.VITE_BNBSMARTCHAIN_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.bscChainId, bscAdapter);
        this.logger.log('BNB Smart Chain adapter initialized');
    }
    async initializePolygonAdapter(chainAdapterManager) {
        const polygonHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_POLYGON_HTTP_URL,
        }));
        const polygonWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_POLYGON_WS_URL);
        const polygonAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: polygonHttp, ws: polygonWs },
            rpcUrl: process.env.VITE_POLYGON_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.polygonChainId, polygonAdapter);
        this.logger.log('Polygon adapter initialized');
    }
    async initializeGnosisAdapter(chainAdapterManager) {
        const gnosisHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_GNOSIS_HTTP_URL,
        }));
        const gnosisWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_GNOSIS_WS_URL);
        const gnosisAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: gnosisHttp, ws: gnosisWs },
            rpcUrl: process.env.VITE_GNOSIS_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.gnosisChainId, gnosisAdapter);
        this.logger.log('Gnosis adapter initialized');
    }
    async initializeArbitrumAdapter(chainAdapterManager) {
        const arbitrumHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_ARBITRUM_HTTP_URL,
        }));
        const arbitrumWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_ARBITRUM_WS_URL);
        const arbitrumAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: arbitrumHttp, ws: arbitrumWs },
            rpcUrl: process.env.VITE_ARBITRUM_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.arbitrumChainId, arbitrumAdapter);
        this.logger.log('Arbitrum adapter initialized');
    }
    async initializeArbitrumNovaAdapter(chainAdapterManager) {
        const arbitrumNovaHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_ARBITRUM_NOVA_HTTP_URL,
        }));
        const arbitrumNovaWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_ARBITRUM_NOVA_WS_URL);
        const arbitrumNovaAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: arbitrumNovaHttp, ws: arbitrumNovaWs },
            rpcUrl: process.env.VITE_ARBITRUM_NOVA_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.arbitrumNovaChainId, arbitrumNovaAdapter);
        this.logger.log('Arbitrum Nova adapter initialized');
    }
    async initializeBaseAdapter(chainAdapterManager) {
        const baseHttp = new unchained.ethereum.V1Api(new unchained.ethereum.Configuration({
            basePath: process.env.VITE_UNCHAINED_BASE_HTTP_URL,
        }));
        const baseWs = new unchained.ws.Client(process.env.VITE_UNCHAINED_BASE_WS_URL);
        const baseAdapter = new chain_adapters_1.ethereum.ChainAdapter({
            providers: { http: baseHttp, ws: baseWs },
            rpcUrl: process.env.VITE_BASE_NODE_URL,
            thorMidgardUrl: process.env.VITE_THORCHAIN_MIDGARD_URL,
            mayaMidgardUrl: process.env.VITE_MAYACHAIN_MIDGARD_URL,
        });
        chainAdapterManager.set(caip_1.baseChainId, baseAdapter);
        this.logger.log('Base adapter initialized');
    }
    isEvmChainAdapter(chainAdapter) {
        return chain_adapters_2.evmChainIds.includes(chainAdapter.getChainId());
    }
    assertGetEvmChainAdapter(chainId) {
        const chainAdapterManager = this.chainAdapterManagerService.getChainAdapterManager();
        const adapter = chainAdapterManager.get(chainId);
        if (!this.isEvmChainAdapter(adapter)) {
            throw Error('invalid chain adapter');
        }
        return adapter;
    }
};
exports.EvmChainAdapterService = EvmChainAdapterService;
exports.EvmChainAdapterService = EvmChainAdapterService = EvmChainAdapterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [chain_adapter_manager_service_1.ChainAdapterManagerService])
], EvmChainAdapterService);
