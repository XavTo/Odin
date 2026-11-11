import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { GameService } from './game.service';
import { GameRoom, GameSettings } from './game.types';
interface Payload {
  roomId?: unknown;
  name?: unknown;
  game?: unknown;
  cardIds?: unknown;
  takeCardId?: unknown;
  revision?: unknown;
  melds?: unknown;
  playerId?: unknown;
  settings?: Partial<GameSettings>;
  photos?: unknown;
}
@WebSocketGateway({ cors: { origin: '*' }, maxHttpBufferSize: 4_000_000 })
export class GameGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  @WebSocketServer() server: Server;
  private timer?: ReturnType<typeof setInterval>;
  private rates = new Map<string, { time: number; count: number }>();
  constructor(
    private readonly gameService: GameService,
    private readonly auth: AuthService,
  ) {}
  afterInit(): void {
    this.server.use((socket, next) => {
      if (this.auth.accepts(socket.handshake.auth?.accessToken)) next();
      else next(new Error('SITE_AUTH_REQUIRED'));
    });
    this.timer = setInterval(() => {
      for (const room of this.gameService.tick()) this.emitState(room);
    }, 1000);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  handleConnection(client: Socket): void {
    const { profile, token, room, previousSocket, reset } =
      this.gameService.connect(client.id, client.handshake.auth?.token);
    if (previousSocket) {
      const old = this.server.sockets.sockets.get(previousSocket);
      old?.emit('sessionReplaced');
      old?.disconnect(true);
    }
    client.data.adminToken = client.handshake.auth?.adminToken;
    const isAdmin = this.auth.acceptsAdmin(client.data.adminToken);
    client.emit('session', {
      playerId: profile.id,
      token,
      name: profile.name,
      isAdmin,
      photos: this.gameService.getPhotos(),
      reset,
    });
    if (room) {
      void client.join(room.id);
      this.emitState(room);
    }
  }
  handleDisconnect(client: Socket): void {
    this.rates.delete(client.id);
    const room = this.gameService.disconnect(client.id);
    if (room) this.emitState(room);
  }
  @SubscribeMessage('createRoom')
  create(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.createRoom(p?.name, c.id, p?.game),
    );
  }
  @SubscribeMessage('joinRoom')
  join(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.joinRoom(p?.roomId, p?.name, c.id),
    );
  }
  @SubscribeMessage('startGame')
  start(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () => this.gameService.startGame(p?.roomId, c.id));
  }
  @SubscribeMessage('nextRound')
  nextRound(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () => this.gameService.nextRound(p?.roomId, c.id));
  }
  @SubscribeMessage('playCards')
  play(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.playCards(
        p?.roomId,
        c.id,
        p?.cardIds,
        p?.takeCardId,
        p?.revision,
      ),
    );
  }
  @SubscribeMessage('pass')
  pass(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.pass(p?.roomId, c.id, p?.revision),
    );
  }
  @SubscribeMessage('submitMelds')
  melds(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.submitMelds(p?.roomId, c.id, p?.melds, p?.revision),
    );
  }
  @SubscribeMessage('drawTile')
  draw(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.draw(p?.roomId, c.id, p?.revision),
    );
  }
  @SubscribeMessage('savePhotos')
  savePhotos(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    try {
      this.limit(c);
      this.requireAdmin(c);
      for (const room of this.gameService.savePhotos(p?.photos))
        this.emitState(room);
      const photos = this.gameService.getPhotos();
      for (const socket of this.server.sockets.sockets.values())
        socket.emit('photosUpdated', { photos });
      return { ok: true };
    } catch (e) {
      return this.error(e);
    }
  }
  @SubscribeMessage('getPhotos')
  getPhotos(@ConnectedSocket() c: Socket) {
    try {
      this.limit(c);
      this.requireAdmin(c);
      return { ok: true, photos: this.gameService.getPhotos() };
    } catch (e) {
      return this.error(e);
    }
  }
  private requireAdmin(client: Socket): void {
    if (!this.auth.acceptsAdmin(client.data.adminToken))
      throw new Error('Accès administrateur requis.');
  }
  @SubscribeMessage('updateSettings')
  settings(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.updateSettings(p?.roomId, c.id, p?.settings ?? {}),
    );
  }
  @SubscribeMessage('claimHost')
  claim(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () => this.gameService.claimHost(p?.roomId, c.id));
  }
  @SubscribeMessage('removeOffline')
  remove(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    return this.run(c, () =>
      this.gameService.removeOffline(p?.roomId, c.id, p?.playerId),
    );
  }
  @SubscribeMessage('leaveRoom')
  leave(@ConnectedSocket() c: Socket) {
    const old = this.gameService.getRoomBySocket(c.id);
    const result = this.run(c, () => this.gameService.leaveRoomBySocket(c.id));
    if (result.ok) {
      if (old) void c.leave(old.id);
      c.emit('roomLeft');
    }
    return result;
  }
  @SubscribeMessage('getLeaderboard')
  leaderboard(@MessageBody() p: Payload, @ConnectedSocket() c: Socket) {
    try {
      this.limit(c);
      return { ok: true, rows: this.gameService.leaderboard(p?.game) };
    } catch (e) {
      return this.error(e);
    }
  }
  @SubscribeMessage('sync')
  sync(@ConnectedSocket() c: Socket) {
    const room = this.gameService.getRoomBySocket(c.id);
    if (room) this.emitState(room);
    return { ok: true };
  }
  private run(c: Socket, action: () => GameRoom | null) {
    try {
      this.limit(c);
      const room = action();
      if (room) {
        void c.join(room.id);
        this.emitState(room);
      }
      return { ok: true };
    } catch (e) {
      const room = this.gameService.getRoomBySocket(c.id);
      if (room)
        c.emit(
          'state',
          this.gameService.buildStateForPlayer(
            room,
            room.players.find((p) => p.socketId === c.id)!.id,
          ),
        );
      return this.error(e);
    }
  }
  private limit(c: Socket): void {
    const now = Date.now();
    let rate = this.rates.get(c.id);
    if (!rate || now - rate.time > 1000) {
      rate = { time: now, count: 0 };
      this.rates.set(c.id, rate);
    }
    if (++rate.count > 20)
      throw new Error('Trop d’actions. Patientez un instant.');
  }
  private error(e: unknown) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Erreur du serveur.',
    };
  }
  private emitState(room: GameRoom): void {
    for (const p of room.players)
      if (p.connected && !p.forfeited)
        this.server
          .to(p.socketId)
          .emit('state', this.gameService.buildStateForPlayer(room, p.id));
  }
}
