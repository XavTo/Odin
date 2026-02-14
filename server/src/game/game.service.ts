import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Card,
  GameRoom,
  GameState,
  GameSettings,
  Player,
  PublicGameState,
} from './game.types';
import {
  createDeck,
  dealHand,
  getNextPlayerId,
  hasMonoColorOrValue,
  hasUniqueCardIds,
  isValidCombo,
  MAX_PLAYERS,
  MIN_PLAYERS,
  HAND_SIZE,
  removeCardsFromHand,
  shuffle,
  computePlayValue,
} from './game.logic';

@Injectable()
export class GameService {
  private rooms = new Map<string, GameRoom>();

  createRoom(name: string, socketId: string): { room: GameRoom; player: Player } {
    const roomId = this.generateRoomId();
    const player = this.createPlayer(name, socketId);
    const settings: GameSettings = {
      maxScore: 15,
      colorCount: 6,
    };
    const state: GameState = {
      phase: 'lobby',
      deck: [],
      discard: [],
      table: [],
      lastPlay: null,
      currentPlayerId: null,
      passed: new Set<string>(),
      leaderRequired: false,
      round: 0,
      winners: null,
    };
    const room: GameRoom = {
      id: roomId,
      hostId: player.id,
      players: [player],
      state,
      roundStarterId: null,
      settings,
    };
    this.rooms.set(roomId, room);
    return { room, player };
  }

  joinRoom(roomId: string, name: string, socketId: string): { room: GameRoom; player: Player } {
    const room = this.getRoom(roomId);
    if (room.state.phase !== 'lobby') {
      throw new Error('La partie a deja commence.');
    }
    if (room.players.length >= MAX_PLAYERS) {
      throw new Error('La salle est pleine.');
    }
    const player = this.createPlayer(name, socketId);
    room.players.push(player);
    return { room, player };
  }

  leaveRoomBySocket(socketId: string): GameRoom | null {
    const entry = this.findRoomBySocket(socketId);
    if (!entry) return null;

    const { room, player } = entry;
    room.players = room.players.filter((p) => p.id !== player.id);
    room.state.passed.delete(player.id);

    if (room.hostId === player.id) {
      room.hostId = room.players[0]?.id ?? '';
    }

    if (room.roundStarterId === player.id) {
      room.roundStarterId = room.players[0]?.id ?? null;
    }

    if (room.players.length === 0) {
      this.rooms.delete(room.id);
      return null;
    }

    if (room.state.phase === 'playing') {
      if (room.state.currentPlayerId === player.id) {
        room.state.currentPlayerId = getNextPlayerId(room.players, player.id);
      }

      if (room.state.lastPlay?.playerId === player.id) {
        room.state.lastPlay = null;
        room.state.table = [];
        room.state.leaderRequired = true;
      }

      if (room.players.length < MIN_PLAYERS) {
        room.state.phase = 'game_end';
        room.state.winners = [room.players[0].id];
        room.state.currentPlayerId = null;
      }
    }

    return room;
  }

  startGame(roomId: string, socketId: string): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.getPlayerBySocket(room, socketId);
    if (player.id !== room.hostId) {
      throw new Error('Seul l hote peut demarrer.');
    }
    if (room.players.length < MIN_PLAYERS) {
      throw new Error('Il faut au moins 2 joueurs.');
    }
    if (room.state.phase !== 'lobby') {
      throw new Error('La partie a deja commence.');
    }

    room.settings = this.normalizeSettings(room.settings);
    room.state.phase = 'playing';
    const starterId = this.pickRandomPlayer(room).id;
    room.roundStarterId = starterId;
    this.startNewRound(room, starterId);
    return room;
  }

  updateSettings(
    roomId: string,
    socketId: string,
    settings: Partial<GameSettings>,
  ): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.getPlayerBySocket(room, socketId);
    if (player.id !== room.hostId) {
      throw new Error('Seul l hote peut modifier les options.');
    }
    if (room.state.phase !== 'lobby') {
      throw new Error('Options verrouillees une fois la partie demarree.');
    }
    const nextSettings: GameSettings = {
      maxScore:
        typeof settings.maxScore === 'number'
          ? settings.maxScore
          : room.settings.maxScore,
      colorCount:
        typeof settings.colorCount === 'number'
          ? settings.colorCount
          : room.settings.colorCount,
    };
    room.settings = this.normalizeSettings(nextSettings);
    return room;
  }

  playCards(
    roomId: string,
    socketId: string,
    cardIds: string[],
    takeCardId?: string,
  ): GameRoom {
    const room = this.getRoom(roomId);
    if (room.state.phase !== 'playing') {
      throw new Error('La partie n est pas en cours.');
    }
    if (!cardIds.length) {
      throw new Error('Choisissez au moins une carte.');
    }
    if (!hasUniqueCardIds(cardIds)) {
      throw new Error('Cartes dupliquees.');
    }

    const player = this.getPlayerBySocket(room, socketId);
    if (room.state.currentPlayerId !== player.id) {
      throw new Error('Ce n est pas votre tour.');
    }

    if (room.state.leaderRequired && cardIds.length !== 1) {
      const isFullHand = cardIds.length === player.hand.length;
      if (!isFullHand || !hasMonoColorOrValue(player.hand)) {
        throw new Error('Le premier joueur du tour doit jouer 1 carte.');
      }
    }

    const { nextHand, removed } = removeCardsFromHand(player.hand, cardIds);
    if (removed.length !== cardIds.length) {
      throw new Error('Cartes invalides.');
    }

    if (!isValidCombo(removed)) {
      throw new Error('Cartes non compatibles (meme couleur ou meme valeur).');
    }

    const previousTable = room.state.table;
    const previousPlay = room.state.lastPlay;

    if (!room.state.leaderRequired && previousPlay) {
      const allowedCounts = [previousPlay.count, previousPlay.count + 1];
      if (!allowedCounts.includes(removed.length)) {
        throw new Error('Vous devez jouer le meme nombre de cartes ou une de plus.');
      }
      const value = computePlayValue(removed);
      if (value <= previousPlay.value) {
        throw new Error('Votre combinaison doit etre plus forte.');
      }
    }

    const playValue = computePlayValue(removed);
    const willEmptyHand = nextHand.length === 0;

    if (!willEmptyHand && previousTable.length > 1) {
      if (!takeCardId) {
        throw new Error('Choisissez une carte a recuperer.');
      }
      const exists = previousTable.some((card) => card.id === takeCardId);
      if (!exists) {
        throw new Error('Carte a recuperer invalide.');
      }
    }
    if (!willEmptyHand && previousTable.length === 1 && takeCardId) {
      const exists = previousTable[0].id === takeCardId;
      if (!exists) {
        throw new Error('Carte a recuperer invalide.');
      }
    }

    player.hand = nextHand;

    if (player.hand.length === 0) {
      room.state.discard.push(...previousTable, ...removed);
      room.state.table = [];
      room.state.lastPlay = null;
      this.finishRound(room, player.id);
      return room;
    }

    if (previousTable.length > 0) {
      const chosenCard = this.selectTakenCard(previousTable, takeCardId);
      if (!chosenCard) {
        throw new Error('Choisissez une carte a recuperer.');
      }
      player.hand.push(chosenCard);
      const remaining = previousTable.filter((card) => card.id !== chosenCard.id);
      room.state.discard.push(...remaining);
    }

    room.state.table = removed;
    room.state.lastPlay = {
      playerId: player.id,
      cards: removed,
      value: playValue,
      count: removed.length,
    };
    room.state.leaderRequired = false;
    room.state.passed.clear();
    room.state.currentPlayerId = getNextPlayerId(room.players, player.id);

    return room;
  }

  pass(roomId: string, socketId: string): GameRoom {
    const room = this.getRoom(roomId);
    if (room.state.phase !== 'playing') {
      throw new Error('La partie n est pas en cours.');
    }
    const player = this.getPlayerBySocket(room, socketId);
    if (room.state.currentPlayerId !== player.id) {
      throw new Error('Ce n est pas votre tour.');
    }
    if (room.state.leaderRequired) {
      throw new Error('Vous devez jouer une carte pour lancer le tour.');
    }

    room.state.passed.add(player.id);

    if (this.shouldEndTour(room)) {
      const lastPlay = room.state.lastPlay;
      if (lastPlay) {
        room.state.discard.push(...room.state.table);
        room.state.table = [];
        room.state.lastPlay = null;
        room.state.passed.clear();
        room.state.leaderRequired = true;
        room.state.currentPlayerId = lastPlay.playerId;
        return room;
      }
    }

    room.state.currentPlayerId = getNextPlayerId(room.players, player.id);
    return room;
  }

  buildStateForPlayer(room: GameRoom, playerId: string): PublicGameState {
    const player = room.players.find((p) => p.id === playerId) ?? null;
    const winners = room.state.winners
      ? room.state.winners
          .map((id) => room.players.find((p) => p.id === id))
          .filter((p): p is Player => Boolean(p))
          .map((p) => ({ id: p.id, name: p.name }))
      : null;

    return {
      roomId: room.id,
      phase: room.state.phase,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        handCount: p.hand.length,
        isHost: p.id === room.hostId,
        isCurrent: p.id === room.state.currentPlayerId,
        passed: room.state.passed.has(p.id),
      })),
      you: player ? { id: player.id, name: player.name } : null,
      hand: player?.hand ?? [],
      table: room.state.table,
      lastPlay: room.state.lastPlay,
      currentPlayerId: room.state.currentPlayerId,
      leaderRequired: room.state.leaderRequired,
      round: room.state.round,
      roundStarterId: room.roundStarterId,
      deckCount: room.state.deck.length,
      discardCount: room.state.discard.length,
      settings: room.settings,
      effectiveColorCount: this.resolveColorCount(room),
      winners,
      canStart: room.state.phase === 'lobby' && room.hostId === player?.id,
    };
  }

  getRoom(roomId: string): GameRoom {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Salle introuvable.');
    }
    return room;
  }

  getRoomBySocket(socketId: string): GameRoom | null {
    const entry = this.findRoomBySocket(socketId);
    return entry?.room ?? null;
  }

  private startNewRound(room: GameRoom, starterId: string): void {
    const colorCount = this.resolveColorCount(room);
    const deck = shuffle(createDeck(colorCount));
    room.state.deck = deck;
    room.state.discard = [];
    room.state.table = [];
    room.state.lastPlay = null;
    room.state.passed = new Set();
    room.state.leaderRequired = true;
    room.state.currentPlayerId = starterId;
    room.state.round += 1;
    room.state.winners = null;

    let remainingDeck = deck;
    for (const player of room.players) {
      const dealt = dealHand(remainingDeck, HAND_SIZE);
      player.hand = dealt.hand;
      remainingDeck = dealt.rest;
    }
    room.state.deck = remainingDeck;

  }

  private finishRound(room: GameRoom, winnerId: string): void {
    for (const player of room.players) {
      if (player.id !== winnerId) {
        player.score += player.hand.length;
      }
    }

    const maxScore = Math.max(...room.players.map((p) => p.score));
    if (maxScore >= room.settings.maxScore) {
      const minScore = Math.min(...room.players.map((p) => p.score));
      room.state.phase = 'game_end';
      room.state.winners = room.players
        .filter((p) => p.score === minScore)
        .map((p) => p.id);
      room.state.currentPlayerId = null;
      room.state.leaderRequired = false;
      room.state.table = [];
      room.state.lastPlay = null;
      room.state.passed.clear();
      return;
    }

    const previousStarter = room.roundStarterId ?? winnerId;
    room.roundStarterId = this.resolveNextStarter(room, previousStarter);
    this.startNewRound(room, room.roundStarterId);
  }

  private resolveNextStarter(room: GameRoom, previousStarter: string): string {
    const ids = room.players.map((p) => p.id);
    if (!ids.includes(previousStarter)) {
      return room.players[0].id;
    }
    return getNextPlayerId(room.players, previousStarter);
  }

  private selectTakenCard(cards: Card[], takeCardId?: string): Card | null {
    if (cards.length === 1) {
      return cards[0];
    }
    if (!takeCardId) {
      return null;
    }
    return cards.find((card) => card.id === takeCardId) ?? null;
  }

  private shouldEndTour(room: GameRoom): boolean {
    const lastPlay = room.state.lastPlay;
    if (!lastPlay) return false;
    const activePlayers = room.players.filter((p) => p.id !== lastPlay.playerId);
    return room.state.passed.size >= activePlayers.length;
  }

  private createPlayer(name: string, socketId: string): Player {
    return {
      id: randomUUID(),
      name: name.trim() || 'Joueur',
      socketId,
      hand: [],
      score: 0,
    };
  }

  private pickRandomPlayer(room: GameRoom): Player {
    const index = Math.floor(Math.random() * room.players.length);
    return room.players[index];
  }

  private getPlayerBySocket(room: GameRoom, socketId: string): Player {
    const player = room.players.find((p) => p.socketId === socketId);
    if (!player) {
      throw new Error('Joueur introuvable.');
    }
    return player;
  }

  private findRoomBySocket(
    socketId: string,
  ): { room: GameRoom; player: Player } | null {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        return { room, player };
      }
    }
    return null;
  }

  private generateRoomId(): string {
    let id = '';
    while (!id || this.rooms.has(id)) {
      id = Math.random().toString(36).slice(2, 6).toUpperCase();
    }
    return id;
  }

  private resolveColorCount(room: GameRoom): number {
    const normalized = this.normalizeSettings(room.settings);
    if (room.players.length === 2) {
      return Math.max(4, normalized.colorCount - 2);
    }
    return normalized.colorCount;
  }

  private normalizeSettings(settings: GameSettings): GameSettings {
    const maxScore = Math.max(5, Math.min(50, Math.round(settings.maxScore)));
    const colorCount = Math.max(4, Math.min(6, Math.round(settings.colorCount)));
    return { maxScore, colorCount };
  }
}
