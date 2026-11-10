import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GameService } from './game.service';
import { GameStore } from './game.store';
import { Card, GameRoom } from './game.types';
const card = (n: number, color: Card['color'] = 'red'): Card => ({
  id: `${color}-${n}`,
  value: n,
  color,
});
describe('Persistent multiplayer games', () => {
  let service: GameService, directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'odin-test-'));
    process.env.DATA_DIR = directory;
    service = new GameService(new GameStore());
  });
  afterEach(() => {
    delete process.env.DATA_DIR;
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });
  function room(game: 'odin' | 'rummikub' = 'odin'): GameRoom {
    service.connect('a');
    service.connect('b');
    const r = service.createRoom('Alice', 'a', game);
    service.joinRoom(r.id, 'Bob', 'b');
    service.startGame(r.id, 'a');
    return r;
  }
  it('restores the exact identity, hand, turn and room after a refresh', () => {
    const a = service.connect('a');
    service.connect('b');
    const r = service.createRoom('Alice', 'a');
    service.joinRoom(r.id, 'Bob', 'b');
    service.startGame(r.id, 'a');
    const before = service.buildStateForPlayer(r, a.profile.id);
    service.disconnect('a');
    expect(r.players).toHaveLength(2);
    expect(r.state.phase).toBe('playing');
    const restored = service.connect('a2', a.token);
    expect(restored.profile.id).toBe(a.profile.id);
    expect(restored.room?.id).toBe(r.id);
    const after = service.buildStateForPlayer(r, a.profile.id);
    expect(after.hand).toEqual(before.hand);
    expect(after.currentPlayerId).toBe(before.currentPlayerId);
    expect(() => service.pass(r.id, 'a', r.revision)).toThrow();
  });
  it('restores rooms across process restart and pauses the clock while all are offline', () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const a = service.connect('a'),
      b = service.connect('b');
    const r = service.createRoom('Alice', 'a', 'rummikub');
    service.joinRoom(r.id, 'Bob', 'b');
    service.startGame(r.id, 'a');
    const hand = [...r.players[0].hand];
    now += 10000;
    service.disconnect('a');
    service.disconnect('b');
    now += 3600000;
    const restarted = new GameService(new GameStore());
    const restored = restarted.connect('a2', a.token);
    expect(restored.room!.players[0].hand).toEqual(hand);
    expect(restored.room!.state.deadline! - now).toBe(50000);
    expect(restored.room!.players[1].connected).toBe(false);
    expect(restarted.connect('b2', b.token).room!.id).toBe(r.id);
  });
  it('replaces an old tab without letting its disconnect remove the new tab', () => {
    const a = service.connect('a');
    const r = service.createRoom('Alice', 'a');
    expect(service.connect('a2', a.token).previousSocket).toBe('a');
    expect(service.disconnect('a')).toBeNull();
    expect(r.players[0].socketId).toBe('a2');
  });
  it('keeps the host across a refresh and allows an explicit transfer after 30 seconds offline', () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const a = service.connect('a');
    service.connect('b');
    const r = service.createRoom('Alice', 'a');
    service.joinRoom(r.id, 'Bob', 'b');
    service.disconnect('a');
    expect(r.hostId).toBe(a.profile.id);
    expect(() => service.claimHost(r.id, 'b')).toThrow('30 secondes');
    service.connect('a2', a.token);
    expect(r.hostId).toBe(a.profile.id);
    service.disconnect('a2');
    now += 30001;
    service.claimHost(r.id, 'b');
    expect(r.hostId).toBe(r.players[1].id);
  });
  it('never sends other hands, deck contents or authentication keys', () => {
    const r = room();
    const state = service.buildStateForPlayer(r, r.players[0].id);
    const wire = JSON.stringify(state);
    expect(state.hand).toEqual(r.players[0].hand);
    expect(state.players[1]).not.toHaveProperty('hand');
    expect(wire).not.toContain('tokenHash');
    expect(state).not.toHaveProperty('deck');
  });
  it('deals nine cards to six players even with four requested colors', () => {
    service.connect('a');
    const r = service.createRoom('A', 'a');
    for (let i = 1; i < 6; i++) {
      service.connect(`p${i}`);
      service.joinRoom(r.id, `P${i}`, `p${i}`);
    }
    service.updateSettings(r.id, 'a', { colorCount: 4 });
    service.startGame(r.id, 'a');
    expect(r.players.map((p) => p.hand.length)).toEqual([9, 9, 9, 9, 9, 9]);
  });
  it('rejects bad settings and duplicate room memberships', () => {
    service.connect('a');
    const r = service.createRoom('Alice', 'a');
    expect(() =>
      service.updateSettings(r.id, 'a', { maxScore: NaN }),
    ).toThrow();
    const before = JSON.stringify(r.settings);
    expect(() =>
      service.updateSettings(r.id, 'a', {
        maxScore: 50,
        photos: { '1': 'https://bad' },
      }),
    ).toThrow();
    expect(JSON.stringify(r.settings)).toBe(before);
    expect(() => service.createRoom('Again', 'a')).toThrow('déjà');
  });
  it('keeps a selection valid when emptying a hand without taking a table card', () => {
    const r = room();
    const [a, b] = r.players;
    a.hand = [card(8), card(9)];
    b.hand = [card(2), card(3, 'blue')];
    r.state.currentPlayerId = a.id;
    r.state.leaderRequired = false;
    r.state.table = [card(6, 'blue'), card(7, 'blue')];
    r.state.lastPlay = {
      playerId: b.id,
      cards: r.state.table,
      value: 76,
      count: 2,
    };
    service.playCards(
      r.id,
      'a',
      a.hand.map((c) => c.id),
      undefined,
      r.revision,
    );
    expect(r.state.phase).toBe('round_end');
    expect(b.score).toBe(2);
    expect(r.state.round).toBe(1);
    expect(r.state.roundResult?.winnerIds).toEqual([a.id]);
    service.nextRound(r.id, 'a');
    expect(r.state.round).toBe(2);
    expect(a.hand).toHaveLength(9);
  });
  it('ends a mono hand automatically on a new trick and records the final match once', () => {
    const r = room();
    const [a, b] = r.players;
    a.hand = [card(8), card(9)];
    b.hand = [card(2), card(3, 'blue')];
    b.score = 14;
    r.state.currentPlayerId = b.id;
    r.state.leaderRequired = false;
    r.state.table = [card(7)];
    r.state.lastPlay = {
      playerId: a.id,
      cards: r.state.table,
      value: 7,
      count: 1,
    };
    r.moves = 3;
    service.pass(r.id, 'b', r.revision);
    expect(r.state.phase).toBe('game_end');
    expect(service.leaderboard('odin').find((p) => p.id === a.id)?.wins).toBe(
      1,
    );
    service.disconnect('a');
    expect(service.leaderboard('odin').find((p) => p.id === a.id)?.played).toBe(
      1,
    );
  });
  it('closes a trick when the last non-passing opponent leaves', () => {
    const r = room();
    service.connect('c');
    r.state.phase = 'lobby';
    service.joinRoom(r.id, 'Claire', 'c');
    service.startGame(r.id, 'a');
    const [a, b, c] = r.players;
    a.hand = [card(8), card(4, 'blue')];
    r.state.currentPlayerId = c.id;
    r.state.leaderRequired = false;
    r.state.table = [card(7)];
    r.state.lastPlay = {
      playerId: a.id,
      cards: r.state.table,
      value: 7,
      count: 1,
    };
    r.state.passed.add(b.id);
    service.leaveRoomBySocket('c');
    expect(r.state.currentPlayerId).toBe(a.id);
    expect(r.state.leaderRequired).toBe(true);
    expect(r.state.table).toEqual([]);
  });
  it('rejects stale actions and rejected plays leave hands and table untouched', () => {
    const r = room();
    r.state.currentPlayerId = r.players[0].id;
    const before = JSON.stringify(r);
    expect(() =>
      service.playCards(r.id, 'a', ['invalid'], undefined, r.revision),
    ).toThrow();
    expect(JSON.stringify(r)).toBe(before);
    expect(() =>
      service.playCards(
        r.id,
        'a',
        [r.players[0].hand[0].id],
        undefined,
        r.revision - 1,
      ),
    ).toThrow('changé');
  });
  it('draws exactly one tile at timeout, never repeatedly for the same turn', () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const r = room('rummikub');
    const current = r.players.find((p) => p.id === r.state.currentPlayerId)!;
    now += 60001;
    expect(service.tick()).toHaveLength(1);
    expect(current.hand).toHaveLength(15);
    expect(service.tick()).toHaveLength(0);
    expect(r.state.currentPlayerId).not.toBe(current.id);
  });
  it('scores a blocked Rummikub game by differences with joker penalties', () => {
    const r = room('rummikub');
    const [a, b] = r.players;
    a.hand = [card(2)];
    b.hand = [{ id: 'joker', color: 'black', value: 0, joker: true }];
    r.state.deck = [];
    r.state.currentPlayerId = a.id;
    r.moves = 1;
    service.draw(r.id, 'a', r.revision);
    expect(r.state.phase).toBe('playing');
    service.draw(r.id, 'b', r.revision);
    expect(r.state.winners).toEqual([a.id]);
    expect(a.score).toBe(28);
    expect(b.score).toBe(-28);
  });
  it('persists completed rankings and cannot farm rating by abandoning an unplayed game', () => {
    const r = room('rummikub');
    service.leaveRoomBySocket('b');
    expect(r.state.winners).toEqual([r.players[0].id]);
    expect(service.leaderboard('rummikub')).toEqual([]);
    const restarted = new GameService(new GameStore());
    expect(restarted.leaderboard('rummikub')).toEqual([]);
  });
  it('refuses to overwrite a corrupted snapshot', () => {
    writeFileSync(join(directory, 'games.json'), '{broken');
    expect(() => new GameService(new GameStore())).toThrow();
  });
});
