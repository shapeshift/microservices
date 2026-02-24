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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapsController = exports.Prisma = exports.Swap = void 0;
const common_1 = require("@nestjs/common");
const swaps_service_1 = require("./swaps.service");
const swap_polling_service_1 = require("../polling/swap-polling.service");
const swap_verification_service_1 = require("../verification/swap-verification.service");
var client_1 = require("@prisma/client");
Object.defineProperty(exports, "Swap", { enumerable: true, get: function () { return client_1.Swap; } });
Object.defineProperty(exports, "Prisma", { enumerable: true, get: function () { return client_1.Prisma; } });
let SwapsController = class SwapsController {
    constructor(swapsService, swapPollingService, swapVerificationService) {
        this.swapsService = swapsService;
        this.swapPollingService = swapPollingService;
        this.swapVerificationService = swapVerificationService;
    }
    async createSwap(data) {
        return this.swapsService.createSwap(data);
    }
    async updateSwapStatus(swapId, data) {
        return this.swapsService.updateSwapStatus({
            swapId,
            ...data,
        });
    }
    async getSwapsByUser(userId, limit) {
        return this.swapsService.getSwapsByUser(userId, limit ? parseInt(limit) : 50);
    }
    async getSwapsByAccountId(accountId) {
        return this.swapsService.getSwapsByAccountId(accountId);
    }
    async getPendingSwaps() {
        return this.swapsService.getPendingSwaps();
    }
    async getReferralFees(referralCode, startDate, endDate) {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;
        return this.swapsService.calculateReferralFees(referralCode, start, end);
    }
    async getAffiliateFees(affiliateAddress, startDate, endDate) {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;
        return this.swapsService.calculateAffiliateFees(affiliateAddress, start, end);
    }
    async getSwap(swapId) {
        const swap = await this.swapsService['prisma'].swap.findUnique({
            where: { swapId },
        });
        if (!swap) {
            return null;
        }
        return {
            ...swap,
            sellAsset: swap.sellAsset,
            buyAsset: swap.buyAsset,
        };
    }
    async verifySwapAffiliate(swapId, data) {
        // Fetch the swap to get metadata and other details
        const swap = await this.swapsService['prisma'].swap.findUnique({
            where: { swapId },
        });
        if (!swap) {
            return {
                isVerified: false,
                hasAffiliate: false,
                protocol: data.protocol,
                swapId,
                error: 'Swap not found',
            };
        }
        return this.swapVerificationService.verifySwapAffiliate(swapId, data.protocol || swap.swapperName, swap.sellAsset.chainId, data.txHash || swap.sellTxHash || undefined, swap.metadata);
    }
};
exports.SwapsController = SwapsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "createSwap", null);
__decorate([
    (0, common_1.Put)(':swapId/status'),
    __param(0, (0, common_1.Param)('swapId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "updateSwapStatus", null);
__decorate([
    (0, common_1.Get)('user/:userId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "getSwapsByUser", null);
__decorate([
    (0, common_1.Get)('account/:accountId'),
    __param(0, (0, common_1.Param)('accountId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "getSwapsByAccountId", null);
__decorate([
    (0, common_1.Get)('pending'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "getPendingSwaps", null);
__decorate([
    (0, common_1.Get)('referral-fees/:referralCode'),
    __param(0, (0, common_1.Param)('referralCode')),
    __param(1, (0, common_1.Query)('startDate')),
    __param(2, (0, common_1.Query)('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "getReferralFees", null);
__decorate([
    (0, common_1.Get)('affiliate-fees/:affiliateAddress'),
    __param(0, (0, common_1.Param)('affiliateAddress')),
    __param(1, (0, common_1.Query)('startDate')),
    __param(2, (0, common_1.Query)('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "getAffiliateFees", null);
__decorate([
    (0, common_1.Get)(':swapId'),
    __param(0, (0, common_1.Param)('swapId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "getSwap", null);
__decorate([
    (0, common_1.Post)(':swapId/verify-affiliate'),
    __param(0, (0, common_1.Param)('swapId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SwapsController.prototype, "verifySwapAffiliate", null);
exports.SwapsController = SwapsController = __decorate([
    (0, common_1.Controller)('swaps'),
    __metadata("design:paramtypes", [swaps_service_1.SwapsService,
        swap_polling_service_1.SwapPollingService,
        swap_verification_service_1.SwapVerificationService])
], SwapsController);
