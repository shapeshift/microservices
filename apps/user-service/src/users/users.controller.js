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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
let UsersController = class UsersController {
    constructor(usersService) {
        this.usersService = usersService;
    }
    async createUser(data) {
        return this.usersService.createUser(data);
    }
    async getOrCreateUser(data) {
        return this.usersService.getOrCreateUserByAccountIds(data.accountIds, data.referralCode);
    }
    async getAllUsers(limit) {
        return this.usersService.getAllUsers(limit ? parseInt(limit) : 50);
    }
    async getUserById(userId) {
        return this.usersService.getUserById(userId);
    }
    async getUserByAccountId(accountId) {
        return this.usersService.getUserByAccountId(accountId);
    }
    async userExistsWithAccountId(accountId) {
        const exists = await this.usersService.userExistsWithAccountId(accountId);
        return { exists };
    }
    async getOrCreateUserByAccountId(data) {
        return this.usersService.getOrCreateUserByAccountId(data.accountId);
    }
    async addAccountIds(userId, data) {
        return this.usersService.addAccountIds(userId, data.accountIds);
    }
    async addAccountId(userId, data) {
        return this.usersService.addAccountId({
            userId,
            accountId: data.accountId,
        });
    }
    async registerDevice(userId, data) {
        return this.usersService.registerDevice({
            userId,
            deviceToken: data.deviceToken,
            deviceType: data.deviceType,
        });
    }
    async getUserDevices(userId) {
        return this.usersService.getUserDevices(userId);
    }
    async removeDevice(userId, deviceId) {
        return this.usersService.removeDevice(userId, deviceId);
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "createUser", null);
__decorate([
    (0, common_1.Post)('get-or-create'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getOrCreateUser", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getAllUsers", null);
__decorate([
    (0, common_1.Get)(':userId'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getUserById", null);
__decorate([
    (0, common_1.Get)('account/:accountId'),
    __param(0, (0, common_1.Param)('accountId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getUserByAccountId", null);
__decorate([
    (0, common_1.Get)('exists/account/:accountId'),
    __param(0, (0, common_1.Param)('accountId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "userExistsWithAccountId", null);
__decorate([
    (0, common_1.Post)('get-or-create-by-account'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getOrCreateUserByAccountId", null);
__decorate([
    (0, common_1.Post)(':userId/account-ids'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "addAccountIds", null);
__decorate([
    (0, common_1.Post)(':userId/account-id'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "addAccountId", null);
__decorate([
    (0, common_1.Post)(':userId/devices'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "registerDevice", null);
__decorate([
    (0, common_1.Get)(':userId/devices'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getUserDevices", null);
__decorate([
    (0, common_1.Delete)(':userId/devices/:deviceId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('deviceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "removeDevice", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], UsersController);
