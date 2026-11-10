import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuthService } from './auth.service';
describe('Site access password', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'odin-access-'));
    process.env.DATA_DIR = directory;
    process.env.SITE_PASSWORD = 'test-only-password';
  });
  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.SITE_PASSWORD;
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });
  it('requires the configured password and returns a reusable signed access token', () => {
    const auth = new AuthService();
    expect(auth.required).toBe(true);
    expect(auth.accepts(undefined)).toBe(false);
    expect(() => auth.login('wrong', 'test')).toThrow('incorrect');
    const access = auth.login('test-only-password', 'test');
    expect(auth.accepts(access.accessToken)).toBe(true);
    expect(new AuthService().accepts(access.accessToken)).toBe(true);
    expect(access.accessToken).not.toContain('test-only-password');
  });
  it('rejects fabricated, modified and expired tokens', () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const auth = new AuthService();
    const token = auth.login('test-only-password', 'test').accessToken!;
    expect(auth.accepts('anything')).toBe(false);
    expect(auth.accepts('x'.repeat(2000))).toBe(false);
    const [payload, signature] = token.split('.');
    expect(auth.accepts(`${payload}x.${signature}`)).toBe(false);
    now += 31 * 86400000;
    expect(auth.accepts(token)).toBe(false);
  });
  it('invalidates remembered access when the Railway password changes', () => {
    const token = new AuthService().login(
      'test-only-password',
      'test',
    ).accessToken;
    process.env.SITE_PASSWORD = 'a-different-test-password';
    const changed = new AuthService();
    expect(changed.accepts(token)).toBe(false);
    expect(() => changed.login('test-only-password', 'test')).toThrow();
  });
  it('limits wrong guesses and allows access again when the window expires', () => {
    let now = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const auth = new AuthService();
    for (let i = 0; i < 20; i++)
      expect(() => auth.login('wrong', 'test')).toThrow('incorrect');
    expect(() => auth.login('test-only-password', 'test')).toThrow(
      'Trop de tentatives',
    );
    now += 5 * 60000 + 1;
    expect(
      auth.accepts(auth.login('test-only-password', 'test').accessToken),
    ).toBe(true);
  });
  it('allows local development without a password when the variable is unset', () => {
    delete process.env.SITE_PASSWORD;
    const auth = new AuthService();
    expect(auth.required).toBe(false);
    expect(auth.accepts(undefined)).toBe(true);
  });
});
