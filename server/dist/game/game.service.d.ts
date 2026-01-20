import { GameRoom, GameSettings, Player, PublicGameState } from './game.types';
export declare class GameService {
    private rooms;
    createRoom(name: string, socketId: string): {
        room: GameRoom;
        player: Player;
    };
    joinRoom(roomId: string, name: string, socketId: string): {
        room: GameRoom;
        player: Player;
    };
    leaveRoomBySocket(socketId: string): GameRoom | null;
    startGame(roomId: string, socketId: string): GameRoom;
    updateSettings(roomId: string, socketId: string, settings: Partial<GameSettings>): GameRoom;
    playCards(roomId: string, socketId: string, cardIds: string[], takeCardId?: string): GameRoom;
    pass(roomId: string, socketId: string): GameRoom;
    buildStateForPlayer(room: GameRoom, playerId: string): PublicGameState;
    getRoom(roomId: string): GameRoom;
    getRoomBySocket(socketId: string): GameRoom | null;
    private startNewRound;
    private finishRound;
    private resolveNextStarter;
    private selectTakenCard;
    private shouldEndTour;
    private createPlayer;
    private pickRandomPlayer;
    private getPlayerBySocket;
    private findRoomBySocket;
    private generateRoomId;
    private resolveColorCount;
    private normalizeSettings;
}
