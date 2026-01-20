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
exports.GameGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const game_service_1 = require("./game.service");
let GameGateway = class GameGateway {
    gameService;
    server;
    constructor(gameService) {
        this.gameService = gameService;
    }
    handleDisconnect(client) {
        const room = this.gameService.leaveRoomBySocket(client.id);
        if (room) {
            this.emitState(room);
        }
    }
    handleCreateRoom(payload, client) {
        try {
            const { room, player } = this.gameService.createRoom(payload?.name ?? '', client.id);
            client.join(room.id);
            client.emit('roomJoined', {
                roomId: room.id,
                playerId: player.id,
                hostId: room.hostId,
            });
            this.emitState(room);
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    handleJoinRoom(payload, client) {
        try {
            const { room, player } = this.gameService.joinRoom(payload?.roomId?.toUpperCase() ?? '', payload?.name ?? '', client.id);
            client.join(room.id);
            client.emit('roomJoined', {
                roomId: room.id,
                playerId: player.id,
                hostId: room.hostId,
            });
            this.emitState(room);
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    handleStartGame(payload, client) {
        try {
            const room = this.gameService.startGame(payload.roomId, client.id);
            this.emitState(room);
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    handlePlayCards(payload, client) {
        try {
            const room = this.gameService.playCards(payload.roomId, client.id, payload.cardIds ?? [], payload.takeCardId);
            this.emitState(room);
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    handlePass(payload, client) {
        try {
            const room = this.gameService.pass(payload.roomId, client.id);
            this.emitState(room);
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    handleUpdateSettings(payload, client) {
        try {
            const room = this.gameService.updateSettings(payload.roomId, client.id, {
                maxScore: payload.maxScore,
                colorCount: payload.colorCount,
            });
            this.emitState(room);
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    handleLeaveRoom(client) {
        try {
            const room = this.gameService.leaveRoomBySocket(client.id);
            if (room) {
                client.leave(room.id);
                this.emitState(room);
            }
            client.emit('roomLeft');
        }
        catch (error) {
            this.emitError(client, error);
        }
    }
    emitState(room) {
        for (const player of room.players) {
            const state = this.gameService.buildStateForPlayer(room, player.id);
            this.server.to(player.socketId).emit('state', state);
        }
    }
    emitError(client, error) {
        const message = error instanceof Error ? error.message : 'Erreur inconnue.';
        client.emit('serverError', { message });
    }
};
exports.GameGateway = GameGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], GameGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('createRoom'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handleCreateRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('joinRoom'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handleJoinRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('startGame'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handleStartGame", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('playCards'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handlePlayCards", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('pass'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handlePass", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('updateSettings'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handleUpdateSettings", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('leaveRoom'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], GameGateway.prototype, "handleLeaveRoom", null);
exports.GameGateway = GameGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: '*',
        },
    }),
    __metadata("design:paramtypes", [game_service_1.GameService])
], GameGateway);
//# sourceMappingURL=game.gateway.js.map