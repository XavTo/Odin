import { Injectable } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { GameRoom, Profile } from './game.types';
interface Snapshot {
  version: number;
  profiles: Profile[];
  rooms: Array<
    Omit<GameRoom, 'state'> & {
      state: Omit<GameRoom['state'], 'passed'> & { passed: string[] };
    }
  >;
}
@Injectable()
export class GameStore {
  readonly directory =
    process.env.DATA_DIR ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    join(process.cwd(), 'data');
  load(): { profiles: Profile[]; rooms: GameRoom[] } {
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, 'games.json');
    if (!existsSync(path)) return { profiles: [], rooms: [] };
    const data = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
    if (
      data.version !== 1 ||
      !Array.isArray(data.rooms) ||
      !Array.isArray(data.profiles)
    )
      throw new Error(
        'Sauvegarde invalide : restaurer games.json avant de démarrer.',
      );
    const now = Date.now();
    return {
      profiles: data.profiles,
      rooms: data.rooms
        .filter((r) => now - r.updatedAt < 7 * 86400000)
        .map((r) => ({
          ...r,
          pausedAt: r.pausedAt ?? r.updatedAt,
          players: r.players.map((p) => ({
            ...p,
            connected: false,
            socketId: '',
            disconnectedAt: p.disconnectedAt ?? now,
          })),
          state: { ...r.state, passed: new Set(r.state.passed) },
        })),
    };
  }
  save(rooms: Iterable<GameRoom>, profiles: Iterable<Profile>): void {
    const path = join(this.directory, 'games.json');
    const data: Snapshot = {
      version: 1,
      profiles: [...profiles],
      rooms: [...rooms].map((r) => ({
        ...r,
        state: { ...r.state, passed: [...r.state.passed] },
      })),
    };
    // Atomic replacement: a crash during writing cannot truncate the last valid snapshot.
    writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }
}
