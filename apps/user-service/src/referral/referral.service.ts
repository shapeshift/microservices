import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralCode, ReferralUsage } from '@prisma/client';

type CreateReferralCodeDto = {
  code: string;
  ownerAddress: string;
  maxUses?: number;
  expiresAt?: Date;
};

type UseReferralCodeDto = {
  code: string;
  refereeAddress: string;
};

type ReferralCodeWithUsages = ReferralCode & {
  usages: ReferralUsage[];
  _count?: {
    usages: number;
  };
};

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(private prisma: PrismaService) {}

  async createReferralCode(data: CreateReferralCodeDto): Promise<ReferralCode> {
    try {
      const existingCode = await this.prisma.referralCode.findUnique({
        where: { code: data.code },
      });

      if (existingCode) {
        throw new BadRequestException('Referral code already exists');
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
    } catch (error) {
      this.logger.error('Failed to create referral code', error);
      throw error;
    }
  }

  async useReferralCode(data: UseReferralCodeDto): Promise<ReferralUsage> {
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
        throw new NotFoundException('Referral code not found');
      }

      if (!referralCode.isActive) {
        throw new BadRequestException('Referral code is inactive');
      }

      if (referralCode.expiresAt && referralCode.expiresAt < new Date()) {
        throw new BadRequestException('Referral code has expired');
      }

      if (referralCode.maxUses && referralCode._count.usages >= referralCode.maxUses) {
        throw new BadRequestException('Referral code has reached maximum uses');
      }

      if (referralCode.ownerAddress === data.refereeAddress) {
        throw new BadRequestException('Cannot use your own referral code');
      }

      const existingUsage = await this.prisma.referralUsage.findUnique({
        where: { refereeAddress: data.refereeAddress },
      });

      if (existingUsage) {
        throw new BadRequestException('Address has already used a referral code');
      }

      const usage = await this.prisma.referralUsage.create({
        data: {
          referralCode: data.code,
          refereeAddress: data.refereeAddress,
        },
      });

      this.logger.log(`Referral code ${data.code} used by ${data.refereeAddress}`);
      return usage;
    } catch (error) {
      this.logger.error('Failed to use referral code', error);
      throw error;
    }
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCodeWithUsages | null> {
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

  async getReferralCodesByOwner(ownerAddress: string): Promise<ReferralCodeWithUsages[]> {
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

  async getReferralUsageByAddress(refereeAddress: string): Promise<ReferralUsage | null> {
    const usage = await this.prisma.referralUsage.findUnique({
      where: { refereeAddress },
    });

    return usage;
  }

  async deactivateReferralCode(code: string, ownerAddress: string): Promise<ReferralCode> {
    try {
      const referralCode = await this.prisma.referralCode.findUnique({
        where: { code },
      });

      if (!referralCode) {
        throw new NotFoundException('Referral code not found');
      }

      if (referralCode.ownerAddress !== ownerAddress) {
        throw new BadRequestException('Not authorized to deactivate this referral code');
      }

      const updatedCode = await this.prisma.referralCode.update({
        where: { code },
        data: { isActive: false },
      });

      this.logger.log(`Deactivated referral code: ${code}`);
      return updatedCode;
    } catch (error) {
      this.logger.error('Failed to deactivate referral code', error);
      throw error;
    }
  }

  async getAllReferralCodes(limit = 50): Promise<ReferralCodeWithUsages[]> {
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
}
