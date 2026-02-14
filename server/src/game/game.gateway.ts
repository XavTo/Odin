import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { GameRoom } from './game.types';

interface CreateRoomPayload {
  name: string;
}

interface JoinRoomPayload {
  roomId: string;
  name: string;
}

interface RoomPayload {
  roomId: string;
}

interface PlayCardsPayload {
  roomId: string;
  cardIds: string[];
  takeCardId?: string;
}

interface UpdateSettingsPayload {
  roomId: string;
  maxScore?: number;
  colorCount?: number;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway {
  @WebSocketServer() server: Server;

  constructor(private readonly gameService: GameService) {}

  handleDisconnect(client: Socket): void {
    const room = this.gameService.leaveRoomBySocket(client.id);
    if (room) {
      this.emitState(room);
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    @MessageBody() payload: CreateRoomPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    try {
      const { room, player } = this.gameService.createRoom(
        payload?.name ?? '',
        client.id,
      );
      client.join(room.id);
      client.emit('roomJoined', {
        roomId: room.id,
        playerId: player.id,
        hostId: room.hostId,
      });
      this.emitState(room);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() payload: JoinRoomPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    try {
      const { room, player } = this.gameService.joinRoom(
        payload?.roomId?.toUpperCase() ?? '',
        payload?.name ?? '',
        client.id,
      );
      client.join(room.id);
      client.emit('roomJoined', {
        roomId: room.id,
        playerId: player.id,
        hostId: room.hostId,
      });
      this.emitState(room);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('startGame')
  handleStartGame(
    @MessageBody() payload: RoomPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    try {
      const room = this.gameService.startGame(payload.roomId, client.id);
      this.emitState(room);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('playCards')
  handlePlayCards(
    @MessageBody() payload: PlayCardsPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    try {
      const room = this.gameService.playCards(
        payload.roomId,
        client.id,
        payload.cardIds ?? [],
        payload.takeCardId,
      );
      this.emitState(room);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('pass')
  handlePass(
    @MessageBody() payload: RoomPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    try {
      const room = this.gameService.pass(payload.roomId, client.id);
      this.emitState(room);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('updateSettings')
  handleUpdateSettings(
    @MessageBody() payload: UpdateSettingsPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    try {
      const room = this.gameService.updateSettings(payload.roomId, client.id, {
        maxScore: payload.maxScore,
        colorCount: payload.colorCount,
      });
      this.emitState(room);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(@ConnectedSocket() client: Socket): void {
    try {
      const room = this.gameService.leaveRoomBySocket(client.id);
      if (room) {
        client.leave(room.id);
        this.emitState(room);
      }
      client.emit('roomLeft');
    } catch (error) {
      this.emitError(client, error);
    }
  }

  private emitState(room: GameRoom): void {
    for (const player of room.players) {
      const state = this.gameService.buildStateForPlayer(room, player.id);
      this.server.to(player.socketId).emit('state', state);
    }
  }

  private emitError(client: Socket, error: unknown): void {
    const message =
      error instanceof Error ? error.message : 'Erreur inconnue.';
    client.emit('serverError', { message });
  }
}
