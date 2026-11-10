import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const ACCESS_DURATION = 30 * 24 * 60 * 60 * 1000;
@Injectable()
export class AuthService {
  private readonly password = process.env.SITE_PASSWORD ?? '';
  private readonly adminPassword = process.env.ADMIN_PASSWORD ?? '';
  private readonly key: Buffer;
  private readonly adminKey: Buffer;
  private attempts = new Map<string, { count: number; until: number }>();
  constructor() {
    if (this.adminPassword && this.adminPassword === this.password)
      throw new Error('ADMIN_PASSWORD doit être différent de SITE_PASSWORD.');
    if (!this.password && !this.adminPassword) {
      this.key = Buffer.alloc(0);
      this.adminKey = Buffer.alloc(0);
      return;
    }
    const directory =
      process.env.DATA_DIR ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH ||
      join(process.cwd(), 'data');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, 'access-secret');
    if (!existsSync(file))
      writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
    const secret = readFileSync(file);
    if (secret.length !== 32)
      throw new Error(
        'Clé d’accès invalide. Restaurer le fichier access-secret.',
      );
    this.key = createHmac('sha256', secret).update(this.password).digest();
    this.adminKey = createHmac('sha256', secret)
      .update(`admin:${this.adminPassword}`)
      .digest();
  }
  get required(): boolean {
    return this.password.length > 0;
  }
  accepts(token: unknown): boolean {
    return !this.required || this.verify(token, this.key);
  }
  acceptsAdmin(token: unknown): boolean {
    return Boolean(this.adminPassword) && this.verify(token, this.adminKey);
  }
  private verify(token: unknown, key: Buffer): boolean {
    if (typeof token !== 'string' || token.length > 1024) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const signature = Buffer.from(parts[1], 'base64url');
    const expected = createHmac('sha256', key).update(parts[0]).digest();
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      return false;
    try {
      const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      return typeof p.expiresAt === 'number' && p.expiresAt > Date.now();
    } catch {
      return false;
    }
  }
  login(
    password: unknown,
    address: string,
  ): { accessToken: string | null; expiresAt: number | null } {
    if (!this.required) return { accessToken: null, expiresAt: null };
    return this.authenticate(
      password,
      `site:${address}`,
      this.password,
      this.key,
    );
  }
  loginAdmin(
    password: unknown,
    address: string,
  ): { accessToken: string; expiresAt: number } {
    if (!this.adminPassword)
      throw new UnauthorizedException('Administration indisponible.');
    return this.authenticate(
      password,
      `admin:${address}`,
      this.adminPassword,
      this.adminKey,
    );
  }
  private authenticate(
    password: unknown,
    address: string,
    configured: string,
    key: Buffer,
  ): { accessToken: string; expiresAt: number } {
    const now = Date.now();
    for (const [id, attempt] of this.attempts)
      if (attempt.until <= now) this.attempts.delete(id);
    const attempt = this.attempts.get(address);
    if (attempt && attempt.count >= 20)
      throw new HttpException(
        'Trop de tentatives. Réessayez dans cinq minutes.',
        429,
      );
    const actual = createHash('sha256')
      .update(
        typeof password === 'string' && password.length <= 1024 ? password : '',
      )
      .digest();
    const expected = createHash('sha256').update(configured).digest();
    if (!timingSafeEqual(actual, expected)) {
      if (this.attempts.size >= 1000 && !this.attempts.has(address))
        this.attempts.delete(this.attempts.keys().next().value!);
      this.attempts.set(address, {
        count: (attempt?.count ?? 0) + 1,
        until: attempt?.until ?? now + 5 * 60000,
      });
      throw new UnauthorizedException('Mot de passe incorrect.');
    }
    this.attempts.delete(address);
    const expiresAt = now + ACCESS_DURATION;
    const payload = Buffer.from(
      JSON.stringify({ expiresAt, nonce: randomBytes(16).toString('hex') }),
    ).toString('base64url');
    return {
      accessToken: `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`,
      expiresAt,
    };
  }
}
