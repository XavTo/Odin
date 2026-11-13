import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import {
  Card,
  GameRoom,
  GameSettings,
  GameStats,
  GameType,
  Player,
  Profile,
  PublicGameState,
} from './game.types';
import {
  createDeck,
  shuffle,
  computePlayValue,
  isValidCombo,
  hasMonoColorOrValue,
  hasUniqueCardIds,
} from './game.logic';
import { createTiles, rackValue, validateBoard } from './rummikub.logic';
import { GameStore } from './game.store';

@Injectable()
export class GameService implements OnModuleDestroy {
  private previews = new WeakMap<GameRoom, { revision: number; melds: Card[][] }>();
  private rooms = new Map<string, GameRoom>();
  private profiles = new Map<string, Profile>();
  private photos: Record<string, string> = {};
  private sockets = new Map<string, string>();
  constructor(private readonly store: GameStore) {
    const saved = store.load();
    saved.rooms.forEach((r) => {
      if (!/^\d{4}$/.test(r.id)) r.id = this.roomCode();
      this.rooms.set(r.id, r);
    });
    saved.profiles.forEach((p) => this.profiles.set(p.id, p));
    this.photos = saved.photos;
  }
  onModuleDestroy(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      for (const p of room.players) {
        if (p.connected) p.disconnectedAt = now;
        p.connected = false;
        p.socketId = '';
      }
      room.pausedAt ??= now;
    }
    this.save();
  }
  private stats(): GameStats {
    return { rating: 1000, played: 0, wins: 0, draws: 0, points: 0 };
  }
  connect(
    socketId: string,
    token?: unknown,
  ): {
    profile: Profile;
    token?: string;
    room: GameRoom | null;
    previousSocket?: string;
    reset: boolean;
  } {
    const hash = typeof token === 'string' ? this.hash(token) : '';
    let profile = [...this.profiles.values()].find((p) => p.tokenHash === hash);
    const reset = Boolean(token && !profile);
    let newToken: string | undefined;
    if (!profile) {
      newToken = randomBytes(32).toString('hex');
      profile = {
        id: randomUUID(),
        tokenHash: this.hash(newToken),
        name: 'Joueur',
        stats: { odin: this.stats(), rummikub: this.stats() },
      };
      this.profiles.set(profile.id, profile);
    }
    const previousSocket = [...this.sockets].find(
      ([, id]) => id === profile!.id,
    )?.[0];
    if (previousSocket) this.sockets.delete(previousSocket);
    this.sockets.set(socketId, profile.id);
    const room =
      [...this.rooms.values()].find((r) =>
        r.players.some((p) => p.id === profile!.id && !p.forfeited),
      ) ?? null;
    if (room) {
      const player = room.players.find((p) => p.id === profile!.id)!;
      player.socketId = socketId;
      player.connected = true;
      player.disconnectedAt = null;
      if (room.pausedAt && room.state.deadline)
        room.state.deadline += Date.now() - room.pausedAt;
      room.pausedAt = null;
      this.touch(room);
    } else this.save();
    return { profile, token: newToken, room, previousSocket, reset };
  }
  disconnect(socketId: string): GameRoom | null {
    this.sockets.delete(socketId);
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    const player = room.players.find((p) => p.socketId === socketId)!;
    player.connected = false;
    player.socketId = '';
    player.disconnectedAt = Date.now();
    if (!room.players.some((p) => p.connected && !p.forfeited))
      room.pausedAt = Date.now();
    this.touch(room);
    return room;
  }
  createRoom(
    name: unknown,
    socketId: string,
    game: unknown = 'odin',
  ): GameRoom {
    if (game !== 'odin' && game !== 'rummikub') throw new Error('Jeu inconnu.');
    const profile = this.profileForSocket(socketId);
    this.assertAvailable(profile.id);
    const player = this.createPlayer(profile, name, socketId);
    const id = this.roomCode();
    const room: GameRoom = {
      id,
      game,
      hostId: player.id,
      players: [player],
      roundStarterId: null,
      settings: {
        maxScore: 15,
        colorCount: 6,
        turnSeconds: 60,
        photos: { ...this.photos },
      },
      revision: 0,
      updatedAt: Date.now(),
      pausedAt: null,
      rankingRecorded: false,
      moves: 0,
      state: {
        phase: 'lobby',
        deck: [],
        discard: [],
        table: [],
        melds: [],
        lastPlay: null,
        currentPlayerId: null,
        passed: new Set(),
        leaderRequired: false,
        round: 0,
        winners: null,
        roundResult: null,
        deadline: null,
        emptyPasses: 0,
      },
    };
    this.rooms.set(id, room);
    this.touch(room);
    return room;
  }
  joinRoom(roomId: unknown, name: unknown, socketId: string): GameRoom {
    const room = this.getRoom(roomId);
    const profile = this.profileForSocket(socketId);
    this.assertAvailable(profile.id);
    if (room.state.phase !== 'lobby')
      throw new Error('Cette partie a déjà commencé.');
    if (room.players.length >= (room.game === 'odin' ? 6 : 4))
      throw new Error('La salle est pleine.');
    room.players.push(this.createPlayer(profile, name, socketId));
    this.touch(room);
    return room;
  }
  leaveRoomBySocket(socketId: string): GameRoom | null {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    return this.removePlayer(
      room,
      room.players.find((p) => p.socketId === socketId)!,
    );
  }
  claimHost(roomId: unknown, socketId: string): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.playerForSocket(room, socketId);
    const host = room.players.find((p) => p.id === room.hostId);
    if (
      host &&
      !host.forfeited &&
      (host.connected ||
        Date.now() - (host.disconnectedAt ?? Date.now()) < 30000)
    )
      throw new Error(
        'L’hôte garde sa place pendant 30 secondes de reconnexion.',
      );
    room.hostId = player.id;
    this.touch(room);
    return room;
  }
  removeOffline(
    roomId: unknown,
    socketId: string,
    playerId: unknown,
  ): GameRoom | null {
    const room = this.getRoom(roomId);
    this.requireHost(room, socketId);
    const player = room.players.find((p) => p.id === playerId);
    if (!player || player.connected || player.forfeited)
      throw new Error('Seul un joueur déconnecté peut être retiré.');
    return this.removePlayer(room, player);
  }
  private removePlayer(room: GameRoom, player: Player): GameRoom | null {
    if (room.state.phase === 'lobby' || room.state.phase === 'game_end')
      room.players = room.players.filter((p) => p.id !== player.id);
    else {
      player.forfeited = true;
      player.connected = false;
      player.socketId = '';
    }
    const active = this.active(room);
    if (!active.some((p) => p.connected)) room.pausedAt ??= Date.now();
    if (!active.length) {
      this.rooms.delete(room.id);
      this.save();
      return null;
    }
    if (room.hostId === player.id)
      room.hostId = active.find((p) => p.connected)?.id ?? active[0].id;
    if (room.state.phase === 'playing' || room.state.phase === 'round_end') {
      if (active.length === 1) {
        room.state.phase = 'game_end';
        room.state.winners = [active[0].id];
        room.state.currentPlayerId = null;
        room.state.deadline = null;
        room.state.roundResult = {
          winnerIds: [active[0].id],
          points: {},
          reason: 'Victoire par abandon',
        };
        this.recordRanking(room);
      } else if (room.state.currentPlayerId === player.id) {
        room.state.currentPlayerId = this.next(room, player.id);
        this.deadline(room);
      }
    }
    if (room.game === 'odin' && room.state.phase === 'playing')
      this.endTrickIfPassed(room);
    this.touch(room);
    return room;
  }
  startGame(roomId: unknown, socketId: string): GameRoom {
    const room = this.getRoom(roomId);
    this.requireHost(room, socketId);
    if (!['lobby', 'game_end'].includes(room.state.phase))
      throw new Error('Une partie est déjà en cours.');
    const active = this.active(room);
    if (active.length < 2 || active.some((p) => !p.connected))
      throw new Error(
        'Il faut au moins deux joueurs connectés et tous les joueurs présents.',
      );
    room.players = active;
    for (const p of room.players) {
      p.score = 0;
      p.opened = false;
    }
    room.state.round = 0;
    room.rankingRecorded = false;
    room.moves = 0;
    room.roundStarterId =
      room.players[Math.floor(Math.random() * room.players.length)].id;
    this.startRound(room);
    this.touch(room);
    return room;
  }
  nextRound(roomId: unknown, socketId: string): GameRoom {
    const room = this.getRoom(roomId);
    this.requireHost(room, socketId);
    if (room.game !== 'odin' || room.state.phase !== 'round_end')
      throw new Error('Aucune manche à lancer.');
    if (this.active(room).some((p) => !p.connected))
      throw new Error('Attendez la reconnexion des joueurs.');
    room.roundStarterId = this.next(room, room.roundStarterId!);
    this.startRound(room);
    this.touch(room);
    return room;
  }
  updateSettings(
    roomId: unknown,
    socketId: string,
    settings: Partial<GameSettings>,
  ): GameRoom {
    const room = this.getRoom(roomId);
    this.requireHost(room, socketId);
    if (room.state.phase !== 'lobby')
      throw new Error('Les options sont verrouillées pendant la partie.');
    for (const key of ['maxScore', 'colorCount', 'turnSeconds'] as const) {
      if (
        settings[key] !== undefined &&
        (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]))
      )
        throw new Error('Option numérique invalide.');
    }
    const nextSettings = { ...room.settings };
    if (settings.maxScore !== undefined)
      nextSettings.maxScore = Math.max(
        5,
        Math.min(50, Math.round(settings.maxScore)),
      );
    if (settings.colorCount !== undefined)
      nextSettings.colorCount = Math.max(
        4,
        Math.min(6, Math.round(settings.colorCount)),
      );
    if (settings.turnSeconds !== undefined) {
      if (!Number.isInteger(settings.turnSeconds) || settings.turnSeconds < 0 || settings.turnSeconds > 3600)
        throw new Error('Durée de tour invalide.');
      nextSettings.turnSeconds = settings.turnSeconds;
    }
    if (settings.photos !== undefined)
      throw new Error('Modification réservée à l’éditeur administrateur.');
    room.settings = nextSettings;
    this.touch(room);
    return room;
  }
  getPhotos(): Record<string, string> {
    return { ...this.photos };
  }
  savePhotos(input: unknown): GameRoom[] {
    const photos = this.validatePhotos(input);
    this.photos = { ...photos };
    const rooms = [...this.rooms.values()];
    for (const room of rooms) {
      room.settings.photos = { ...photos };
      room.revision++;
      room.updatedAt = Date.now();
    }
    this.save();
    return rooms;
  }
  private validatePhotos(input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Photos invalides.');
    const photos: Record<string, string> = {};
    for (const [value, url] of Object.entries(input)) {
      if (
        !/^(?:(?:r|c)?(?:[1-9]|1[0-3])|joker|background)$/.test(value) ||
        typeof url !== 'string' ||
        url.length > (value === 'background' ? 500000 : 120000) ||
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
      )
        throw new Error('Photo invalide ou trop volumineuse.');
      photos[value] = url;
    }
    return photos;
  }
  playCards(
    roomId: unknown,
    socketId: string,
    cardIds: unknown,
    takeCardId?: unknown,
    revision?: unknown,
  ): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.requireTurn(room, socketId, 'odin', revision);
    if (
      !Array.isArray(cardIds) ||
      !cardIds.length ||
      cardIds.length > 9 ||
      !cardIds.every((id) => typeof id === 'string') ||
      !hasUniqueCardIds(cardIds)
    )
      throw new Error('Sélection de cartes invalide.');
    const chosen = player.hand.filter((c) => cardIds.includes(c.id));
    if (chosen.length !== cardIds.length)
      throw new Error('Ces cartes ne sont pas dans votre main.');
    if (!isValidCombo(chosen))
      throw new Error(
        'Choisissez des cartes de même couleur ou de même valeur.',
      );
    const empties = chosen.length === player.hand.length;
    if (
      room.state.leaderRequired &&
      chosen.length !== 1 &&
      !(empties && hasMonoColorOrValue(player.hand))
    )
      throw new Error('Posez une seule carte pour ouvrir le pli.');
    const last = room.state.lastPlay;
    if (!room.state.leaderRequired && last) {
      if (![last.count, last.count + 1].includes(chosen.length))
        throw new Error(`Posez ${last.count} ou ${last.count + 1} cartes.`);
      if (computePlayValue(chosen) <= last.value)
        throw new Error(`Votre combinaison doit dépasser ${last.value}.`);
    }
    const previous = room.state.table;
    const taken =
      previous.length === 1
        ? previous[0]
        : previous.find((c) => c.id === takeCardId);
    if (!empties && previous.length && !taken)
      throw new Error('Choisissez une carte de la table à récupérer.');
    player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
    room.moves++;
    if (empties) {
      room.state.discard.push(...previous, ...chosen);
      room.state.table = [];
      this.finishOdinRound(room, player.id);
    } else {
      if (taken) player.hand.push(taken);
      room.state.discard.push(...previous.filter((c) => c.id !== taken?.id));
      room.state.table = chosen;
      room.state.lastPlay = {
        playerId: player.id,
        cards: chosen,
        value: computePlayValue(chosen),
        count: chosen.length,
      };
      room.state.leaderRequired = false;
      room.state.passed.clear();
      room.state.currentPlayerId = this.next(room, player.id);
    }
    this.touch(room);
    return room;
  }
  pass(roomId: unknown, socketId: string, revision?: unknown): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.requireTurn(room, socketId, 'odin', revision);
    if (room.state.leaderRequired)
      throw new Error('Vous devez ouvrir le pli avec une carte.');
    room.state.passed.add(player.id);
    if (!this.endTrickIfPassed(room))
      room.state.currentPlayerId = this.next(room, player.id);
    this.touch(room);
    return room;
  }
  private endTrickIfPassed(room: GameRoom): boolean {
    if (!room.state.lastPlay) return false;
    const leader = room.state.lastPlay!.playerId;
    if (
      this.active(room)
        .filter((p) => p.id !== leader)
        .every((p) => room.state.passed.has(p.id))
    ) {
      room.state.discard.push(...room.state.table);
      room.state.table = [];
      room.state.lastPlay = null;
      room.state.passed.clear();
      room.state.leaderRequired = true;
      room.state.currentPlayerId = this.active(room).some(
        (p) => p.id === leader,
      )
        ? leader
        : this.next(room, leader);
      const next = room.players.find(
        (p) => p.id === room.state.currentPlayerId,
      )!;
      if (hasMonoColorOrValue(next.hand)) this.finishOdinRound(room, next.id);
    } else return false;
    return true;
  }
  previewMelds(
    roomId: unknown,
    socketId: string,
    proposed: unknown,
    revision: unknown,
  ): { room: GameRoom; melds: Card[][] | null } {
    const room = this.getRoom(roomId);
    const player = this.requireTurn(room, socketId, 'rummikub', revision);
    if (proposed === null) {
      this.previews.delete(room);
      return { room, melds: null };
    }
    const committed = room.state.melds.flat();
    const known = new Map([...committed, ...player.hand].map((tile) => [tile.id, tile]));
    if (!Array.isArray(proposed) || proposed.length > known.size)
      throw new Error('Table provisoire invalide.');
    const used = new Set<string>();
    const melds = proposed.map((group: unknown) => {
      if (!Array.isArray(group) || group.length < 1 || group.length > known.size)
        throw new Error('Combinaison provisoire invalide.');
      return group.map((id: unknown) => {
        const tile = typeof id === 'string' ? known.get(id) : undefined;
        if (!tile || used.has(tile.id)) throw new Error('Tuile provisoire invalide.');
        used.add(tile.id);
        return tile;
      });
    });
    if (committed.some((tile) => !used.has(tile.id)))
      throw new Error('Les tuiles posées doivent rester sur la table.');
    if (!player.opened && room.state.melds.some((old) =>
      !melds.some((group) => group.length === old.length && group.every((tile, i) => tile.id === old[i].id)),
    )) throw new Error('La première pose doit venir du chevalet.');
    this.previews.set(room, { revision: room.revision, melds });
    return { room, melds };
  }

  submitMelds(
    roomId: unknown,
    socketId: string,
    melds: unknown,
    revision?: unknown,
  ): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.requireTurn(room, socketId, 'rummikub', revision);
    const valid = validateBoard(
      room.state.melds,
      player.hand,
      melds,
      player.opened,
    );
    room.state.melds = valid.melds;
    player.hand = valid.nextHand;
    player.opened = true;
    room.moves++;
    room.state.emptyPasses = 0;
    if (!player.hand.length) this.finishRummikub(room, [player.id], false);
    else {
      room.state.currentPlayerId = this.next(room, player.id);
      this.deadline(room);
    }
    this.touch(room);
    return room;
  }
  draw(roomId: unknown, socketId: string, revision?: unknown): GameRoom {
    const room = this.getRoom(roomId);
    const player = this.requireTurn(room, socketId, 'rummikub', revision);
    this.drawFor(room, player);
    this.touch(room);
    return room;
  }
  private drawFor(room: GameRoom, player: Player, timedOut = false): void {
    const tile = room.state.deck.pop();
    room.state.lastDraw = {
      revision: room.revision + 1,
      playerId: player.id,
      timedOut,
      drewTile: !!tile,
    };
    if (tile) {
      player.hand.push(tile);
      room.state.emptyPasses = 0;
    } else room.state.emptyPasses++;
    if (room.state.emptyPasses >= this.active(room).length) {
      const min = Math.min(...this.active(room).map((p) => rackValue(p.hand)));
      this.finishRummikub(
        room,
        this.active(room)
          .filter((p) => rackValue(p.hand) === min)
          .map((p) => p.id),
        true,
      );
    } else {
      room.state.currentPlayerId = this.next(room, player.id);
      this.deadline(room);
    }
  }
  tick(): GameRoom[] {
    const changed: GameRoom[] = [];
    for (const room of this.rooms.values()) {
      if (
        room.game === 'rummikub' &&
        room.state.phase === 'playing' &&
        !room.pausedAt &&
        room.state.deadline &&
        Date.now() >= room.state.deadline
      ) {
        this.drawFor(
          room,
          room.players.find((p) => p.id === room.state.currentPlayerId)!,
          true,
        );
        this.touch(room);
        changed.push(room);
      }
      if (room.pausedAt && Date.now() - room.updatedAt > 7 * 86400000) {
        this.rooms.delete(room.id);
        this.save();
      }
    }
    return changed;
  }
  leaderboard(game: unknown): Array<{ id: string; name: string } & GameStats> {
    if (game !== 'odin' && game !== 'rummikub') throw new Error('Jeu inconnu.');
    return [...this.profiles.values()]
      .filter((p) => p.stats[game].played > 0)
      .map((p) => ({ id: p.id, name: p.name, ...p.stats[game] }))
      .sort(
        (a, b) =>
          b.rating - a.rating ||
          b.wins - a.wins ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 100);
  }
  buildStateForPlayer(room: GameRoom, playerId: string): PublicGameState {
    const player = room.players.find((p) => p.id === playerId && !p.forfeited);
    const preview = this.previews.get(room);
    return {
      roomId: room.id,
      serverNow: Date.now(),
      game: room.game,
      phase: room.state.phase,
      revision: room.revision,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        handCount: p.hand.length,
        isHost: p.id === room.hostId,
        isCurrent: p.id === room.state.currentPlayerId,
        passed: room.state.passed.has(p.id),
        connected: p.connected,
        opened: p.opened,
        forfeited: p.forfeited,
      })),
      you: player ? { id: player.id, name: player.name } : null,
      hand: player?.hand ?? [],
      table: room.state.table,
      melds: room.state.melds,
      lastPlay: room.state.lastPlay,
      currentPlayerId: room.state.currentPlayerId,
      leaderRequired: room.state.leaderRequired,
      round: room.state.round,
      roundStarterId: room.roundStarterId,
      deckCount: room.state.deck.length,
      discardCount: room.state.discard.length,
      settings: room.settings,
      effectiveColorCount: this.colorCount(room),
      winners:
        room.state.winners?.map((id) => ({
          id,
          name: room.players.find((p) => p.id === id)?.name ?? 'Joueur',
        })) ?? null,
      canStart:
        room.hostId === player?.id &&
        ['lobby', 'game_end', 'round_end'].includes(room.state.phase),
      roundResult: room.state.roundResult,
      deadline: room.state.deadline,
      paused: Boolean(room.pausedAt),
      preview: preview && preview.revision === room.revision && playerId !== room.state.currentPlayerId
        ? preview.melds : null,
      lastDraw: room.state.lastDraw,
    };
  }
  getRoom(roomId: unknown): GameRoom {
    const room =
      typeof roomId === 'string'
        ? this.rooms.get(roomId.trim().toUpperCase())
        : undefined;
    if (!room) throw new Error('Salle introuvable ou expirée.');
    return room;
  }
  getRoomBySocket(socketId: string): GameRoom | null {
    return (
      [...this.rooms.values()].find((r) =>
        r.players.some((p) => p.socketId === socketId && !p.forfeited),
      ) ?? null
    );
  }
  private startRound(room: GameRoom): void {
    const deck = shuffle(
      room.game === 'odin' ? createDeck(this.colorCount(room)) : createTiles(),
    );
    const size = room.game === 'odin' ? 9 : 14;
    for (const player of this.active(room)) {
      player.hand = deck.splice(0, size);
      player.opened = false;
    }
    Object.assign(room.state, {
      phase: 'playing',
      deck,
      discard: [],
      table: [],
      melds: [],
      lastPlay: null,
      lastDraw: undefined,
      currentPlayerId: room.roundStarterId,
      passed: new Set(),
      leaderRequired: room.game === 'odin',
      round: room.state.round + 1,
      winners: null,
      roundResult: null,
      emptyPasses: 0,
    });
    this.deadline(room);
  }
  private finishOdinRound(room: GameRoom, winnerId: string): void {
    const points: Record<string, number> = {};
    for (const p of room.players) {
      points[p.id] = p.id === winnerId ? 0 : p.hand.length;
      p.score += points[p.id];
    }
    room.state.roundResult = {
      winnerIds: [winnerId],
      points,
      reason: 'Manche terminée',
    };
    room.state.currentPlayerId = null;
    room.state.lastPlay = null;
    room.state.leaderRequired = false;
    room.state.passed.clear();
    if (room.players.some((p) => p.score >= room.settings.maxScore)) {
      const min = Math.min(...this.active(room).map((p) => p.score));
      room.state.phase = 'game_end';
      room.state.winners = this.active(room)
        .filter((p) => p.score === min)
        .map((p) => p.id);
      this.recordRanking(room);
    } else room.state.phase = 'round_end';
  }
  private finishRummikub(
    room: GameRoom,
    winnerIds: string[],
    blocked: boolean,
  ): void {
    const points: Record<string, number> = {};
    const min = blocked
      ? rackValue(room.players.find((p) => p.id === winnerIds[0])!.hand)
      : 0;
    let total = 0;
    for (const p of room.players)
      if (!winnerIds.includes(p.id)) {
        points[p.id] = -(rackValue(p.hand) - min);
        total -= points[p.id];
      }
    winnerIds.forEach((id) => {
      points[id] = total / winnerIds.length;
    });
    room.players.forEach((p) => {
      p.score += points[p.id] ?? 0;
    });
    room.state.phase = 'game_end';
    room.state.winners = winnerIds;
    room.state.currentPlayerId = null;
    room.state.deadline = null;
    room.state.roundResult = {
      winnerIds,
      points,
      reason: blocked
        ? 'Pioche épuisée : personne ne peut jouer'
        : 'Rummikub ! Chevalet vidé',
    };
    this.recordRanking(room);
  }
  private recordRanking(room: GameRoom): void {
    if (room.rankingRecorded || !room.moves || !room.state.winners) return;
    const winners = room.state.winners;
    const old = new Map(
      room.players.map((p) => [
        p.id,
        this.profiles.get(p.id)!.stats[room.game].rating,
      ]),
    );
    for (const p of room.players) {
      const stats = this.profiles.get(p.id)!.stats[room.game];
      let delta = 0;
      for (const other of room.players)
        if (other.id !== p.id) {
          const result =
            winners.includes(p.id) === winners.includes(other.id)
              ? 0.5
              : winners.includes(p.id)
                ? 1
                : 0;
          delta +=
            result -
            1 / (1 + 10 ** ((old.get(other.id)! - old.get(p.id)!) / 400));
        }
      stats.rating += Math.round((32 * delta) / (room.players.length - 1));
      stats.played++;
      stats.points += p.score;
      if (winners.includes(p.id)) {
        if (winners.length > 1) stats.draws++;
        else stats.wins++;
      }
    }
    room.rankingRecorded = true;
  }
  private requireTurn(
    room: GameRoom,
    socketId: string,
    game: GameType,
    revision: unknown,
  ): Player {
    if (room.game !== game || room.state.phase !== 'playing')
      throw new Error('Cette action ne correspond pas à la partie en cours.');
    const player = this.playerForSocket(room, socketId);
    if (room.state.currentPlayerId !== player.id)
      throw new Error('Ce n’est pas votre tour.');
    if (revision !== room.revision)
      throw new Error('La partie a changé. Vérifiez la table puis réessayez.');
    if (
      room.state.deadline &&
      !room.pausedAt &&
      Date.now() >= room.state.deadline
    )
      throw new Error('Le temps du tour est écoulé.');
    return player;
  }
  private requireHost(room: GameRoom, socketId: string): void {
    if (this.playerForSocket(room, socketId).id !== room.hostId)
      throw new Error('Seul l’hôte peut effectuer cette action.');
  }
  private playerForSocket(room: GameRoom, socketId: string): Player {
    const p = room.players.find(
      (p) => p.socketId === socketId && p.connected && !p.forfeited,
    );
    if (!p || this.sockets.get(socketId) !== p.id)
      throw new Error('Reconnexion nécessaire.');
    return p;
  }
  private profileForSocket(socketId: string): Profile {
    const profile = this.profiles.get(this.sockets.get(socketId) ?? '');
    if (!profile) throw new Error('Session introuvable. Reconnectez-vous.');
    return profile;
  }
  private createPlayer(
    profile: Profile,
    name: unknown,
    socketId: string,
  ): Player {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 24)
      throw new Error('Choisissez un pseudo de 1 à 24 caractères.');
    profile.name = name.trim().replace(/[\u0000-\u001f\u007f]/g, '');
    return {
      id: profile.id,
      name: profile.name,
      socketId,
      connected: true,
      disconnectedAt: null,
      hand: [],
      score: 0,
      opened: false,
      forfeited: false,
    };
  }
  private assertAvailable(profileId: string): void {
    if (
      [...this.rooms.values()].some((r) =>
        r.players.some((p) => p.id === profileId && !p.forfeited),
      )
    )
      throw new Error(
        'Vous avez déjà une salle. Quittez-la avant d’en créer une autre.',
      );
  }
  private active(room: GameRoom): Player[] {
    return room.players.filter((p) => !p.forfeited);
  }
  private next(room: GameRoom, id: string): string {
    const index = room.players.findIndex((p) => p.id === id);
    for (let i = 1; i <= room.players.length; i++) {
      const p = room.players[(index + i) % room.players.length];
      if (!p.forfeited) return p.id;
    }
    throw new Error('Aucun joueur actif.');
  }
  private roomCode(): string {
    if (this.rooms.size >= 10000)
      throw new Error('Toutes les salles sont occupées. Réessayez plus tard.');
    let id: string;
    do {
      id = randomInt(0, 10000).toString().padStart(4, '0');
    } while (this.rooms.has(id));
    return id;
  }
  private colorCount(room: GameRoom): number {
    return Math.max(
      this.active(room).length,
      this.active(room).length === 2
        ? Math.max(4, room.settings.colorCount - 2)
        : room.settings.colorCount,
    );
  }
  private deadline(room: GameRoom): void {
    room.state.deadline =
      room.game === 'rummikub' && room.settings.turnSeconds > 0
        ? Date.now() + room.settings.turnSeconds * 1000
        : null;
  }
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  private touch(room: GameRoom): void {
    this.previews.delete(room);
    room.revision++;
    room.updatedAt = Date.now();
    this.save();
  }
  private save(): void {
    this.store.save(this.rooms.values(), this.profiles.values(), this.photos);
  }
}
