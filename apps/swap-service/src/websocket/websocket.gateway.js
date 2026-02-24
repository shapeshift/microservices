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
var WebsocketGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsocketGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const swaps_service_1 = require("../swaps/swaps.service");
let WebsocketGateway = WebsocketGateway_1 = class WebsocketGateway {
    constructor(swapsService) {
        this.swapsService = swapsService;
        this.logger = new common_1.Logger(WebsocketGateway_1.name);
        this.connectedClients = new Map();
    }
    handleConnection(client) {
        this.logger.log(`Client connected: ${client.id}`);
    }
    handleDisconnect(client) {
        this.logger.log(`Client disconnected: ${client.id}`);
        if (client.userId) {
            this.connectedClients.delete(client.userId);
        }
    }
    async handleGetSwaps(data, client) {
        if (!client.userId) {
            return { error: 'Not authenticated' };
        }
        try {
            const swaps = await this.swapsService.getSwapsByUser(client.userId, data.limit || 50);
            return { success: true, swaps };
        }
        catch (error) {
            this.logger.error('Failed to get swaps', error);
            return { error: 'Failed to get swaps' };
        }
    }
    sendSwapUpdateToUser(userId, swap) {
        const client = this.connectedClients.get(userId);
        if (client) {
            client.emit('swapUpdate', swap);
        }
        this.server.to(`user:${userId}`).emit('swapUpdate', swap);
    }
    broadcastToAll(event, data) {
        this.server.emit(event, data);
    }
};
exports.WebsocketGateway = WebsocketGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], WebsocketGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('getSwaps'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebsocketGateway.prototype, "handleGetSwaps", null);
exports.WebsocketGateway = WebsocketGateway = WebsocketGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: '*',
        },
    }),
    __metadata("design:paramtypes", [swaps_service_1.SwapsService])
], WebsocketGateway);
