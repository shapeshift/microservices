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
var ReferralService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferralService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const shared_utils_1 = require("@shapeshift/shared-utils");
let ReferralService = ReferralService_1 = class ReferralService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(ReferralService_1.name);
        this.swapServiceClient = new shared_utils_1.SwapServiceClient();
    }
    async createReferralCode(data) {
        try {
            const existingCode = await this.prisma.referralCode.findUnique({
                where: { code: data.code },
            });
            if (existingCode) {
                throw new common_1.BadRequestException('Referral code already exists');
            }
            const referralCode = await this.prisma.referralCode.create({
                data: {
                    code: data.code,
                    ownerAddress: data.ownerAddress,
                    maxUses: data.maxUses,
                    expiresAt: data.expiresAt,
                },
            });
            this.logger.log(`Created referral code: ${data.code} for address ${data.ownerAddress}`);
            return referralCode;
        }
        catch (error) {
            this.logger.error('Failed to create referral code', error);
            throw error;
        }
    }
    async useReferralCode(data) {
        try {
            const referralCode = await this.prisma.referralCode.findUnique({
                where: { code: data.code },
                include: {
                    _count: {
                        select: { usages: true },
                    },
                },
            });
            if (!referralCode) {
                throw new common_1.NotFoundException('Referral code not found');
            }
            if (!referralCode.isActive) {
                throw new common_1.BadRequestException('Referral code is inactive');
            }
            if (referralCode.expiresAt && referralCode.expiresAt < new Date()) {
                throw new common_1.BadRequestException('Referral code has expired');
            }
            if (referralCode.maxUses &&
                referralCode._count.usages >= referralCode.maxUses) {
                throw new common_1.BadRequestException('Referral code has reached maximum uses');
            }
            if (referralCode.ownerAddress === data.refereeAddress) {
                throw new common_1.BadRequestException('Cannot use your own referral code');
            }
            const existingUsage = await this.prisma.referralUsage.findUnique({
                where: { refereeAddress: data.refereeAddress },
            });
            if (existingUsage) {
                throw new common_1.BadRequestException('Address has already used a referral code');
            }
            const usage = await this.prisma.referralUsage.create({
                data: {
                    referralCode: data.code,
                    refereeAddress: data.refereeAddress,
                },
            });
            this.logger.log(`Referral code ${data.code} used by ${data.refereeAddress}`);
            return usage;
        }
        catch (error) {
            this.logger.error('Failed to use referral code', error);
            throw error;
        }
    }
    async getReferralCodeByCode(code) {
        const referralCode = await this.prisma.referralCode.findUnique({
            where: { code },
            include: {
                usages: {
                    where: { isActive: true },
                },
                _count: {
                    select: { usages: true },
                },
            },
        });
        return referralCode;
    }
    async getReferralCodesByOwner(ownerAddress) {
        const referralCodes = await this.prisma.referralCode.findMany({
            where: { ownerAddress },
            include: {
                usages: {
                    where: { isActive: true },
                },
                _count: {
                    select: { usages: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return referralCodes;
    }
    async getReferralUsageByAddress(refereeAddress) {
        const usage = await this.prisma.referralUsage.findUnique({
            where: { refereeAddress },
        });
        return usage;
    }
    async deactivateReferralCode(code, ownerAddress) {
        try {
            const referralCode = await this.prisma.referralCode.findUnique({
                where: { code },
            });
            if (!referralCode) {
                throw new common_1.NotFoundException('Referral code not found');
            }
            if (referralCode.ownerAddress !== ownerAddress) {
                throw new common_1.BadRequestException('Not authorized to deactivate this referral code');
            }
            const updatedCode = await this.prisma.referralCode.update({
                where: { code },
                data: { isActive: false },
            });
            this.logger.log(`Deactivated referral code: ${code}`);
            return updatedCode;
        }
        catch (error) {
            this.logger.error('Failed to deactivate referral code', error);
            throw error;
        }
    }
    async getAllReferralCodes(limit = 50) {
        const referralCodes = await this.prisma.referralCode.findMany({
            take: limit,
            include: {
                usages: {
                    where: { isActive: true },
                },
                _count: {
                    select: { usages: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return referralCodes;
    }
    async getReferralStatsByOwner(ownerAddress, startDate, endDate) {
        const dateFilter = startDate && endDate
            ? {
                usedAt: {
                    gte: startDate,
                    lte: endDate,
                },
            }
            : {};
        const referralCodes = await this.prisma.referralCode.findMany({
            where: { ownerAddress },
            include: {
                usages: {
                    where: {
                        isActive: true,
                        ...dateFilter,
                    },
                },
                _count: {
                    select: { usages: true },
                },
            },
        });
        const totalReferrals = referralCodes.reduce((sum, code) => sum + code.usages.length, 0);
        const activeCodesCount = referralCodes.filter((code) => code.isActive).length;
        // Fetch fee data from swap service for all codes
        let totalFeesCollectedUsd = 0;
        let totalReferrerCommissionUsd = 0;
        const referralCodesWithFees = await Promise.all(referralCodes.map(async (code) => {
            try {
                const feeData = await this.swapServiceClient.calculateReferralFees(code.code, startDate, endDate);
                const feesCollected = parseFloat(feeData.totalFeesCollectedUsd || '0');
                const referrerCommission = parseFloat(feeData.referrerCommissionUsd || '0');
                totalFeesCollectedUsd += feesCollected;
                totalReferrerCommissionUsd += referrerCommission;
                return {
                    code: code.code,
                    isActive: code.isActive,
                    createdAt: code.createdAt,
                    usageCount: code.usages.length,
                    maxUses: code.maxUses,
                    expiresAt: code.expiresAt,
                    swapCount: feeData.swapCount || 0,
                    swapVolumeUsd: feeData.totalSwapVolumeUsd || '0',
                    feesCollectedUsd: feeData.totalFeesCollectedUsd || '0',
                    referrerCommissionUsd: feeData.referrerCommissionUsd || '0',
                };
            }
            catch (error) {
                this.logger.warn(`Failed to fetch fees for code ${code.code}:`, error);
                return {
                    code: code.code,
                    isActive: code.isActive,
                    createdAt: code.createdAt,
                    usageCount: code.usages.length,
                    maxUses: code.maxUses,
                    expiresAt: code.expiresAt,
                    swapCount: 0,
                    swapVolumeUsd: '0',
                    feesCollectedUsd: '0',
                    referrerCommissionUsd: '0',
                };
            }
        }));
        return {
            totalReferrals,
            activeCodesCount,
            totalCodesCount: referralCodes.length,
            totalFeesCollectedUsd: totalFeesCollectedUsd.toFixed(2),
            totalReferrerCommissionUsd: totalReferrerCommissionUsd.toFixed(2),
            referralCodes: referralCodesWithFees,
        };
    }
};
exports.ReferralService = ReferralService;
exports.ReferralService = ReferralService = ReferralService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReferralService);
