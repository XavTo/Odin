export type GameType = 'odin' | 'rummikub';
export type CardColor =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'black';
export interface Card {
  id: string;
  color: CardColor;
  value: number;
  joker?: boolean;
}
export interface GameSettings {
  maxScore: number;
  colorCount: number;
  turnSeconds: number;
  photos: Record<string, string>;
}
export interface Player {
  id: string;
  name: string;
  socketId: string;
  connected: boolean;
  disconnectedAt: number | null;
  hand: Card[];
  score: number;
  opened: boolean;
  forfeited: boolean;
}
export interface Play {
  playerId: string;
  cards: Card[];
  value: number;
  count: number;
}
export type GamePhase = 'lobby' | 'playing' | 'round_end' | 'game_end';
export interface RoundResult {
  winnerIds: string[];
  points: Record<string, number>;
  reason: string;
}
export interface GameState {
  phase: GamePhase;
  deck: Card[];
  discard: Card[];
  table: Card[];
  melds: Card[][];
  lastPlay: Play | null;
  currentPlayerId: string | null;
  passed: Set<string>;
  leaderRequired: boolean;
  round: number;
  winners: string[] | null;
  roundResult: RoundResult | null;
  deadline: number | null;
  emptyPasses: number;
}
export interface GameRoom {
  id: string;
  game: GameType;
  hostId: string;
  players: Player[];
  state: GameState;
  roundStarterId: string | null;
  settings: GameSettings;
  revision: number;
  updatedAt: number;
  pausedAt: number | null;
  rankingRecorded: boolean;
  moves: number;
}
export interface GameStats {
  rating: number;
  played: number;
  wins: number;
  draws: number;
  points: number;
}
export interface Profile {
  id: string;
  tokenHash: string;
  name: string;
  stats: Record<GameType, GameStats>;
}
export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  handCount: number;
  isHost: boolean;
  isCurrent: boolean;
  passed: boolean;
  connected: boolean;
  opened: boolean;
  forfeited: boolean;
}
export interface PublicGameState {
  roomId: string;
  serverNow: number;
  game: GameType;
  phase: GamePhase;
  revision: number;
  players: PublicPlayer[];
  you: { id: string; name: string } | null;
  hand: Card[];
  table: Card[];
  melds: Card[][];
  lastPlay: Play | null;
  currentPlayerId: string | null;
  leaderRequired: boolean;
  round: number;
  roundStarterId: string | null;
  deckCount: number;
  discardCount: number;
  settings: GameSettings;
  effectiveColorCount: number;
  winners: { id: string; name: string }[] | null;
  canStart: boolean;
  roundResult: RoundResult | null;
  deadline: number | null;
  paused: boolean;
}
