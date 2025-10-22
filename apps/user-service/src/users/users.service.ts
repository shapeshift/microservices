import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashAccountId, isValidAccountId } from '@shapeshift/shared-utils';
import { 
  CreateUserDto, 
  AddAccountIdDto, 
  RegisterDeviceDto,
  DeviceType
} from '@shapeshift/shared-types';
import { User, UserAccount, Device } from '@prisma/client';


@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  // Type assertion helpers for Prisma results
  private assertDeviceType(deviceType: string): DeviceType {
    if (deviceType === 'MOBILE' || deviceType === 'WEB') {
      return deviceType;
    }
    throw new Error(`Invalid device type: ${deviceType}`);
  }

  private async findUserByHashedAccountId(hashedAccountId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        userAccounts: {
          some: {
            accountId: hashedAccountId,
          },
        },
      },
      include: {
        userAccounts: true,
        devices: true,
      },
    });
    return user;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    try {
      const hashedAccountIds = data.accountIds.map(id => hashAccountId(id));
      
      for (const hashedAccountId of hashedAccountIds) {
        const existingUser = await this.findUserByHashedAccountId(hashedAccountId);
        if (existingUser) {
          this.logger.log(`User already exists with account ID: ${existingUser.id}`);
          
          const newAccountIds = hashedAccountIds.filter(id => 
            !existingUser.userAccounts.some(ua => ua.accountId === id)
          );
          
          if (newAccountIds.length > 0) {
            await this.addHashedAccountIds(existingUser.id, newAccountIds);
          }
          
          return this.getUserById(existingUser.id);
        }
      }

      const user = await this.prisma.user.create({
        data: {
          userAccounts: {
            create: hashedAccountIds.map(id => ({ 
              accountId: id,
            })),
          },
        },
      });

      this.logger.log(`Created new user: ${user.id} with ${hashedAccountIds.length} account IDs`);
      return this.getUserById(user.id);
    } catch (error) {
      this.logger.error('Failed to create user', error);
      throw error;
    }
  }

  async addAccountIds(userId: string, accountIds: string[]): Promise<UserAccount[]> {
    try {
      const hashedAccountIds = accountIds.map(id => {
        if (!isValidAccountId(id)) {
          throw new Error('Invalid account ID');
        }
        return hashAccountId(id);
      });

      return this.addHashedAccountIds(userId, hashedAccountIds);
    } catch (error) {
      this.logger.error('Failed to add account IDs', error);
      throw error;
    }
  }

  private async addHashedAccountIds(userId: string, hashedAccountIds: string[]): Promise<UserAccount[]> {
    try {
      const userAccounts = await Promise.all(
        hashedAccountIds.map(hashedAccountId =>
          this.prisma.userAccount.upsert({
            where: {
              userId_accountId: {
                userId,
                accountId: hashedAccountId,
              },
            },
            update: {},
            create: {
              userId,
              accountId: hashedAccountId,
            },
          })
        )
      );

      this.logger.log(`Added ${userAccounts.length} account IDs for user ${userId}`);
      return userAccounts;
    } catch (error) {
      this.logger.error('Failed to add hashed account IDs', error);
      throw error;
    }
  }

  async addAccountId(data: AddAccountIdDto): Promise<UserAccount> {
    try {
      if (!isValidAccountId(data.accountId)) {
        throw new Error('Invalid account ID');
      }

      const hashedAccountId = hashAccountId(data.accountId);
      
      const existingUser = await this.findUserByHashedAccountId(hashedAccountId);
      if (existingUser && existingUser.id !== data.userId) {
        throw new Error(`Account ID already belongs to user ${existingUser.id}`);
      }

      const userAccount = await this.prisma.userAccount.upsert({
        where: {
          userId_accountId: {
            userId: data.userId,
            accountId: hashedAccountId,
          },
        },
        update: {},
        create: {
          userId: data.userId,
          accountId: hashedAccountId,
        },
      });

      this.logger.log(`Added account ID for user ${data.userId}`);
      return userAccount;
    } catch (error) {
      this.logger.error('Failed to add account ID', error);
      throw error;
    }
  }

  async getUserById(userId: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userAccounts: true,
        devices: true,
      },
    });
    return user;
  }

  async getUserByAccountId(accountId: string): Promise<User | null> {
    if (!isValidAccountId(accountId)) {
      throw new Error('Invalid account ID');
    }

    const hashedAccountId = hashAccountId(accountId);
    
    const user = await this.prisma.user.findFirst({
      where: {
        userAccounts: {
          some: {
            accountId: hashedAccountId,
          },
        },
      },
      include: {
        userAccounts: true,
        devices: true,
      },
    });
    return user;
  }

  async getAllUsers(limit = 50): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      take: limit,
      include: {
        userAccounts: true,
        devices: {
          where: { isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return users;
  }

  async userExistsWithAccountId(accountId: string): Promise<boolean> {
    if (!isValidAccountId(accountId)) {
      return false;
    }

    const hashedAccountId = hashAccountId(accountId);
    const user = await this.findUserByHashedAccountId(hashedAccountId);
    return !!user;
  }

  async getOrCreateUserByAccountId(accountId: string): Promise<User> {
    if (!isValidAccountId(accountId)) {
      throw new Error('Invalid account ID');
    }

    const hashedAccountId = hashAccountId(accountId);
    const existingUser = await this.findUserByHashedAccountId(hashedAccountId);
    
    if (existingUser) {
      this.logger.log(`Found existing user: ${existingUser.id} for account ID`);
      return existingUser;
    }

    return this.createUser({
      accountIds: [accountId],
    });
  }

  async getOrCreateUserByAccountIds(accountIds: string[]): Promise<User> {
    this.logger.log(`getOrCreateUserByAccountIds called with accountIds: ${JSON.stringify(accountIds)}`);
    
    if (!accountIds || accountIds.length === 0) {
      throw new Error('At least one account ID is required');
    }

    // Validate all account IDs
    accountIds.forEach(id => {
      if (!isValidAccountId(id)) {
        throw new Error(`Invalid account ID: ${id}`);
      }
    });

    const hashedAccountIds = accountIds.map(id => hashAccountId(id));
    this.logger.log(`Hashed account IDs: ${JSON.stringify(hashedAccountIds)}`);
    
    for (const hashedAccountId of hashedAccountIds) {
      const existingUser = await this.findUserByHashedAccountId(hashedAccountId);
      if (existingUser) {
        this.logger.log(`Found existing user: ${existingUser.id} for account ID`);
        
        const newAccountIds = hashedAccountIds.filter(id => 
          !existingUser.userAccounts.some(ua => ua.accountId === id)
        );
        
        if (newAccountIds.length > 0) {
          await this.addHashedAccountIds(existingUser.id, newAccountIds);
        }
        
        const result = await this.getUserById(existingUser.id);
        this.logger.log(`Returning existing user: ${result?.id}`);
        return result!;
      }
    }

    this.logger.log(`No existing user found, creating new user with ${hashedAccountIds.length} account IDs`);
    const user = await this.prisma.user.create({
      data: {
        userAccounts: {
          create: hashedAccountIds.map(id => ({ 
            accountId: id,
          })),
        },
      },
    });

    this.logger.log(`Created new user: ${user.id} with ${hashedAccountIds.length} account IDs`);
    const result = await this.getUserById(user.id);
    this.logger.log(`Returning new user: ${result?.id}`);
    return result!;
  }

  async registerDevice(data: RegisterDeviceDto): Promise<Device> {
    try {
      // Check if user exists
      const user = await this.getUserById(data.userId);
      if (!user) {
        throw new Error('User not found');
      }

      const device = await this.prisma.device.upsert({
        where: {
          deviceToken: data.deviceToken,
        },
        update: {
          userId: data.userId,
          deviceType: data.deviceType,
          isActive: true,
        },
        create: {
          deviceToken: data.deviceToken,
          deviceType: data.deviceType,
          userId: data.userId,
        },
      });

      this.logger.log(`Device registered: ${data.deviceToken} for user ${data.userId} (${data.deviceType})`);
      return device;
    } catch (error) {
      this.logger.error('Failed to register device', error);
      throw error;
    }
  }

  async getUserDevices(userId: string): Promise<Device[]> {
    const devices = await this.prisma.device.findMany({
      where: {
        userId,
        isActive: true,
      },
    });
    return devices;
  }

  async removeDevice(userId: string, deviceId: string): Promise<{ success: boolean }> {
    try {
      await this.prisma.device.updateMany({
        where: {
          id: deviceId,
          userId,
        },
        data: {
          isActive: false,
        },
      });

      this.logger.log(`Removed device ${deviceId} for user ${userId}`);
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to remove device', error);
      throw error;
    }
  }
}
