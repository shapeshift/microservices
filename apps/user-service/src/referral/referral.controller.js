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
exports.ReferralController = void 0;
const common_1 = require("@nestjs/common");
const referral_service_1 = require("./referral.service");
const shared_utils_1 = require("@shapeshift/shared-utils");
let ReferralController = class ReferralController {
    constructor(referralService) {
        this.referralService = referralService;
    }
    async createReferralCode(data) {
        if (!(0, shared_utils_1.isValidAccountId)(data.ownerAddress)) {
            throw new Error('Invalid account ID');
        }
        const hashedOwnerAddress = (0, shared_utils_1.hashAccountId)(data.ownerAddress);
        const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
        return this.referralService.createReferralCode({
            code: data.code,
            ownerAddress: hashedOwnerAddress,
            maxUses: data.maxUses,
            expiresAt,
        });
    }
    async useReferralCode(data) {
        return this.referralService.useReferralCode(data);
    }
    async getAllReferralCodes(limit) {
        return this.referralService.getAllReferralCodes(limit ? parseInt(limit) : 50);
    }
    async getReferralCodeByCode(code) {
        return this.referralService.getReferralCodeByCode(code);
    }
    async getReferralCodesByOwner(ownerAddress) {
        if (!(0, shared_utils_1.isValidAccountId)(ownerAddress)) {
            throw new Error('Invalid account ID');
        }
        const hashedOwnerAddress = (0, shared_utils_1.hashAccountId)(ownerAddress);
        return this.referralService.getReferralCodesByOwner(hashedOwnerAddress);
    }
    async getReferralUsageByAddress(refereeAddress) {
        return this.referralService.getReferralUsageByAddress(refereeAddress);
    }
    async deactivateReferralCode(code, data) {
        if (!(0, shared_utils_1.isValidAccountId)(data.ownerAddress)) {
            throw new Error('Invalid account ID');
        }
        const hashedOwnerAddress = (0, shared_utils_1.hashAccountId)(data.ownerAddress);
        return this.referralService.deactivateReferralCode(code, hashedOwnerAddress);
    }
    async getReferralStats(ownerAddress, startDate, endDate) {
        if (!(0, shared_utils_1.isValidAccountId)(ownerAddress)) {
            throw new Error('Invalid account ID');
        }
        const hashedOwnerAddress = (0, shared_utils_1.hashAccountId)(ownerAddress);
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;
        return this.referralService.getReferralStatsByOwner(hashedOwnerAddress, start, end);
    }
};
exports.ReferralController = ReferralController;
__decorate([
    (0, common_1.Post)('codes'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "createReferralCode", null);
__decorate([
    (0, common_1.Post)('use'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "useReferralCode", null);
__decorate([
    (0, common_1.Get)('codes'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "getAllReferralCodes", null);
__decorate([
    (0, common_1.Get)('codes/:code'),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "getReferralCodeByCode", null);
__decorate([
    (0, common_1.Get)('owner/:ownerAddress'),
    __param(0, (0, common_1.Param)('ownerAddress')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "getReferralCodesByOwner", null);
__decorate([
    (0, common_1.Get)('usage/:refereeAddress'),
    __param(0, (0, common_1.Param)('refereeAddress')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "getReferralUsageByAddress", null);
__decorate([
    (0, common_1.Put)('codes/:code/deactivate'),
    __param(0, (0, common_1.Param)('code')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "deactivateReferralCode", null);
__decorate([
    (0, common_1.Get)('stats/:ownerAddress'),
    __param(0, (0, common_1.Param)('ownerAddress')),
    __param(1, (0, common_1.Query)('startDate')),
    __param(2, (0, common_1.Query)('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ReferralController.prototype, "getReferralStats", null);
exports.ReferralController = ReferralController = __decorate([
    (0, common_1.Controller)('referrals'),
    __metadata("design:paramtypes", [referral_service_1.ReferralService])
], ReferralController);
