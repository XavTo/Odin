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
}

export interface GameSettings {
  maxScore: number;
  colorCount: number;
}

export interface Player {
  id: string;
  name: string;
  socketId: string;
  hand: Card[];
  score: number;
}

export interface Play {
  playerId: string;
  cards: Card[];
  value: number;
  count: number;
}

export type GamePhase = 'lobby' | 'playing' | 'game_end';

export interface GameState {
  phase: GamePhase;
  deck: Card[];
  discard: Card[];
  table: Card[];
  lastPlay: Play | null;
  currentPlayerId: string | null;
  passed: Set<string>;
  leaderRequired: boolean;
  round: number;
  winners: string[] | null;
}

export interface GameRoom {
  id: string;
  hostId: string;
  players: Player[];
  state: GameState;
  roundStarterId: string | null;
  settings: GameSettings;
}

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  handCount: number;
  isHost: boolean;
  isCurrent: boolean;
  passed: boolean;
}

export interface PublicGameState {
  roomId: string;
  phase: GamePhase;
  players: PublicPlayer[];
  you: { id: string; name: string } | null;
  hand: Card[];
  table: Card[];
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
}
