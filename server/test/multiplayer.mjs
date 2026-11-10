// End-to-end wire test: actual server process, Socket.IO clients and restart.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { io } from '../../client/node_modules/socket.io-client/build/esm/index.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'odin-wire-'));
const port = 3317;
let server;
const clients = [];
async function start() {
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Server startup timeout')),
      10000,
    );
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}`));
    });
    server.stdout.on('data', (data) => {
      if (data.toString().includes('Nest application successfully started')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (data) => {
      if (data.toString().includes('EADDRINUSE'))
        reject(new Error('Port 3317 is already in use'));
    });
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Healthcheck unavailable');
}
async function stop() {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
}
async function connect(token) {
  const c = {
    socket: io(`http://127.0.0.1:${port}`, {
      auth: { token },
      reconnection: false,
    }),
    state: null,
    session: null,
  };
  clients.push(c);
  c.socket.on('state', (s) => {
    c.state = s;
  });
  c.session = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Session timeout')), 10000);
    c.socket.once('session', (s) => {
      clearTimeout(timer);
      resolve(s);
    });
  });
  return c;
}
async function cmd(c, event, payload = {}) {
  return c.socket
    .timeout(5000)
    .emitWithAck(event, {
      roomId: c.state?.roomId,
      revision: c.state?.revision,
      ...payload,
    });
}
try {
  await start();
  const a = await connect(),
    b = await connect(),
    outsider = await connect();
  assert.deepEqual(
    await cmd(a, 'createRoom', { name: 'Alice', game: 'odin' }),
    { ok: true },
  );
  const roomId = a.state.roomId;
  assert.equal((await cmd(b, 'joinRoom', { roomId, name: 'Bob' })).ok, true);
  assert.equal((await cmd(a, 'startGame')).ok, true);
  await cmd(b, 'sync');
  assert.equal(a.state.hand.length, 9);
  assert.equal(b.state.hand.length, 9);
  assert.equal(
    (
      await cmd(outsider, 'playCards', {
        roomId,
        cardIds: [a.state.hand[0].id],
        revision: a.state.revision,
      })
    ).ok,
    false,
  );
  const active = a.state.currentPlayerId === a.state.you.id ? a : b;
  assert.equal(
    (await cmd(active, 'playCards', { cardIds: [active.state.hand[0].id] })).ok,
    true,
  );
  await cmd(a, 'sync');
  const before = structuredClone(a.state),
    token = a.session.token;
  a.socket.disconnect();
  const restored = await connect(token);
  await cmd(restored, 'sync');
  assert.equal(restored.session.playerId, a.session.playerId);
  assert.equal(restored.state.roomId, roomId);
  assert.deepEqual(restored.state.hand, before.hand);
  assert.equal(restored.state.currentPlayerId, before.currentPlayerId);
  assert.equal(
    restored.state.players.find((p) => p.id === restored.session.playerId)
      .isHost,
    true,
  );
  const gameBeforeRestart = structuredClone(restored.state);
  clients.forEach((c) => c.socket.disconnect());
  await stop();
  await start();
  const resumed = await connect(token);
  await cmd(resumed, 'sync');
  assert.deepEqual(resumed.state.hand, gameBeforeRestart.hand);
  assert.deepEqual(resumed.state.table, gameBeforeRestart.table);
  assert.equal(resumed.state.roomId, roomId);
  await cmd(resumed, 'leaveRoom');
  const r1 = await connect(),
    r2 = await connect();
  assert.equal(
    (await cmd(r1, 'createRoom', { name: 'R1', game: 'rummikub' })).ok,
    true,
  );
  assert.equal(
    (await cmd(r2, 'joinRoom', { roomId: r1.state.roomId, name: 'R2' })).ok,
    true,
  );
  assert.equal((await cmd(r1, 'startGame')).ok, true);
  await cmd(r2, 'sync');
  assert.equal(r1.state.hand.length, 14);
  assert.equal(r1.state.deckCount, 78);
  const turn = r1.state.currentPlayerId === r1.state.you.id ? r1 : r2;
  const rack = structuredClone(turn.state.hand);
  assert.equal(
    (
      await cmd(turn, 'submitMelds', {
        melds: [['invented-1', 'invented-2', 'invented-3']],
      })
    ).ok,
    false,
  );
  assert.deepEqual(turn.state.hand, rack);
  assert.equal((await cmd(turn, 'drawTile')).ok, true);
  assert.equal(turn.state.hand.length, 15);
  assert.equal(turn.state.deckCount, 77);
  assert.equal((await cmd(turn, 'drawTile')).ok, false);
  console.log(
    'PASS: two-player Odin/Rummikub, authorization, exact refresh recovery, host preservation, process restart, rejected-action atomicity, draw ends turn.',
  );
} finally {
  clients.forEach((c) => c.socket.disconnect());
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
