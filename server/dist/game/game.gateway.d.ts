import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
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
export declare class GameGateway {
    private readonly gameService;
    server: Server;
    constructor(gameService: GameService);
    handleDisconnect(client: Socket): void;
    handleCreateRoom(payload: CreateRoomPayload, client: Socket): void;
    handleJoinRoom(payload: JoinRoomPayload, client: Socket): void;
    handleStartGame(payload: RoomPayload, client: Socket): void;
    handlePlayCards(payload: PlayCardsPayload, client: Socket): void;
    handlePass(payload: RoomPayload, client: Socket): void;
    handleUpdateSettings(payload: UpdateSettingsPayload, client: Socket): void;
    handleLeaveRoom(client: Socket): void;
    private emitState;
    private emitError;
}
export {};
