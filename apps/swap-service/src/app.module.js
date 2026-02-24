"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const axios_1 = require("@nestjs/axios");
const prisma_service_1 = require("./prisma/prisma.service");
const swaps_controller_1 = require("./swaps/swaps.controller");
const swaps_service_1 = require("./swaps/swaps.service");
const swap_polling_service_1 = require("./polling/swap-polling.service");
const swap_verification_service_1 = require("./verification/swap-verification.service");
const websocket_gateway_1 = require("./websocket/websocket.gateway");
const chain_adapter_init_service_1 = require("./lib/chain-adapter-init.service");
const chain_adapter_manager_service_1 = require("./lib/chain-adapter-manager.service");
const evm_service_1 = require("./lib/chain-adapters/evm.service");
const utxo_service_1 = require("./lib/chain-adapters/utxo.service");
const cosmos_sdk_service_1 = require("./lib/chain-adapters/cosmos-sdk.service");
const solana_service_1 = require("./lib/chain-adapters/solana.service");
const config_1 = require("@nestjs/config");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            schedule_1.ScheduleModule.forRoot(),
            axios_1.HttpModule,
            config_1.ConfigModule.forRoot({
                envFilePath: '../../.env',
            }),
        ],
        controllers: [swaps_controller_1.SwapsController],
        providers: [
            prisma_service_1.PrismaService,
            swaps_service_1.SwapsService,
            swap_polling_service_1.SwapPollingService,
            swap_verification_service_1.SwapVerificationService,
            websocket_gateway_1.WebsocketGateway,
            chain_adapter_init_service_1.ChainAdapterInitService,
            chain_adapter_manager_service_1.ChainAdapterManagerService,
            evm_service_1.EvmChainAdapterService,
            utxo_service_1.UtxoChainAdapterService,
            cosmos_sdk_service_1.CosmosSdkChainAdapterService,
            solana_service_1.SolanaChainAdapterService,
        ],
    })
], AppModule);
