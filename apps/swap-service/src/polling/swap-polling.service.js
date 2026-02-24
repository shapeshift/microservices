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
var SwapPollingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapPollingService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const swaps_service_1 = require("../swaps/swaps.service");
const websocket_gateway_1 = require("../websocket/websocket.gateway");
let SwapPollingService = SwapPollingService_1 = class SwapPollingService {
    constructor(swapsService, websocketGateway) {
        this.swapsService = swapsService;
        this.websocketGateway = websocketGateway;
        this.logger = new common_1.Logger(SwapPollingService_1.name);
    }
    async pollPendingSwaps() {
        try {
            this.logger.log('Starting to poll pending swaps...');
            const pendingSwaps = await this.swapsService.getPendingSwaps();
            if (pendingSwaps.length === 0) {
                this.logger.log('No pending swaps found');
                return;
            }
            this.logger.log(`Found ${pendingSwaps.length} pending swaps to poll`);
            for (const swap of pendingSwaps) {
                try {
                    const statusUpdate = await this.swapsService.pollSwapStatus(swap.swapId);
                    if (statusUpdate.status !== swap.status) {
                        this.logger.log(`Status changed for swap ${swap.swapId}: ${swap.status} -> ${statusUpdate.status}`);
                        const updatedSwap = await this.swapsService.updateSwapStatus({
                            swapId: swap.swapId,
                            status: statusUpdate.status,
                            sellTxHash: statusUpdate.sellTxHash,
                            buyTxHash: statusUpdate.buyTxHash,
                            statusMessage: statusUpdate.statusMessage,
                        });
                        await this.websocketGateway.sendSwapUpdateToUser(swap.userId, updatedSwap);
                    }
                }
                catch (error) {
                    this.logger.error(`Failed to poll swap ${swap.swapId}:`, error);
                }
            }
        }
        catch (error) {
            this.logger.error('Failed to poll pending swaps:', error);
        }
    }
};
exports.SwapPollingService = SwapPollingService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_5_SECONDS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SwapPollingService.prototype, "pollPendingSwaps", null);
exports.SwapPollingService = SwapPollingService = SwapPollingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [swaps_service_1.SwapsService,
        websocket_gateway_1.WebsocketGateway])
], SwapPollingService);
