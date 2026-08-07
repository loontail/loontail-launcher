import { type AuthApi, AuthApiError } from '@main/services/auth/authApi';
import { createLoontailAuth } from '@main/services/auth/loontailAuth';
import { LOGIN_ERROR_CODE, type LoontailAuthResponse } from '@shared/contracts/auth';
import { describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

const authResponse = (): LoontailAuthResponse => ({
  session: { token: 'session-token', expiresAt: '2099-01-01T00:00:00.000Z' },
  minecraft: { accessToken: 'mc-access', clientToken: 'mc-client' },
  profile: {
    id: 42,
    username: 'someone',
    email: 'someone@example.com',
    uuid: '0123456789abcdef0123456789abcdef',
    isAdmin: false,
  },
});

const api = (overrides: Partial<AuthApi> = {}): AuthApi => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  me: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('createLoontailAuth.signIn', () => {
  it('splits a login response into session, API bearer, and account', async () => {
    const login = vi.fn().mockResolvedValue(authResponse());
    const auth = createLoontailAuth(api({ login }));

    const result = await auth.signIn({ identifier: 'someone', password: 'pw' });

    expect(login).toHaveBeenCalledWith({ username: 'someone', password: 'pw' });
    expect(result).toEqual({
      ok: true,
      identity: {
        session: {
          provider: 'yggdrasil',
          accessToken: 'mc-access',
          clientToken: 'mc-client',
          profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
        },
        apiSession: { token: 'session-token', expiresAt: Date.UTC(2099, 0, 1) },
        account: {
          provider: 'yggdrasil',
          username: 'someone',
          email: 'someone@example.com',
          skin: null,
          cape: null,
        },
      },
    });
  });

  it('maps a 401 to invalid credentials', async () => {
    const login = vi.fn().mockRejectedValue(new AuthApiError(401, 'nope'));
    const auth = createLoontailAuth(api({ login }));

    expect(await auth.signIn({ identifier: 'x', password: 'y' })).toEqual({
      ok: false,
      error: LOGIN_ERROR_CODE.INVALID_CREDENTIALS,
    });
  });

  it('maps a 429 to rate-limited', async () => {
    const login = vi.fn().mockRejectedValue(new AuthApiError(429, 'slow down'));
    const auth = createLoontailAuth(api({ login }));

    expect(await auth.signIn({ identifier: 'x', password: 'y' })).toEqual({
      ok: false,
      error: LOGIN_ERROR_CODE.RATE_LIMITED,
    });
  });

  it('maps a transport TypeError to a network error', async () => {
    const login = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const auth = createLoontailAuth(api({ login }));

    expect(await auth.signIn({ identifier: 'x', password: 'y' })).toEqual({
      ok: false,
      error: LOGIN_ERROR_CODE.NETWORK_ERROR,
    });
  });
});

describe('createLoontailAuth.register', () => {
  it('forwards the register payload and maps the response', async () => {
    const register = vi.fn().mockResolvedValue(authResponse());
    const auth = createLoontailAuth(api({ register }));

    const result = await auth.register({
      username: 'someone',
      email: 'someone@example.com',
      password: 'pw',
    });

    expect(register).toHaveBeenCalledWith({
      username: 'someone',
      email: 'someone@example.com',
      password: 'pw',
    });
    expect(result.ok).toBe(true);
  });
});

describe('createLoontailAuth.refresh', () => {
  it('rotates the session on success', async () => {
    const refresh = vi.fn().mockResolvedValue(authResponse());
    const auth = createLoontailAuth(api({ refresh }));

    const result = await auth.refresh('old-token');

    expect(refresh).toHaveBeenCalledWith('old-token');
    expect(result).toMatchObject({
      kind: 'ok',
      identity: { apiSession: { token: 'session-token', expiresAt: Date.UTC(2099, 0, 1) } },
    });
  });

  it('reports offline on a transport error so the session is kept', async () => {
    const refresh = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const auth = createLoontailAuth(api({ refresh }));

    expect(await auth.refresh('old-token')).toEqual({ kind: 'offline' });
  });

  it('reports expired when the server rejects the token', async () => {
    const refresh = vi.fn().mockRejectedValue(new AuthApiError(401, 'expired'));
    const auth = createLoontailAuth(api({ refresh }));

    expect(await auth.refresh('old-token')).toEqual({ kind: 'expired' });
  });
});

describe('createLoontailAuth session expiry', () => {
  it('keeps the expiry unknown when the server omits it', async () => {
    const response = authResponse();
    const login = vi.fn().mockResolvedValue({ ...response, session: { token: 'session-token' } });
    const auth = createLoontailAuth(api({ login }));

    const result = await auth.signIn({ identifier: 'someone', password: 'pw' });

    expect(result).toMatchObject({
      ok: true,
      identity: { apiSession: { token: 'session-token', expiresAt: null } },
    });
  });

  it('reads a numeric epoch-seconds expiry as milliseconds', async () => {
    const response = authResponse();
    const login = vi.fn().mockResolvedValue({
      ...response,
      session: { token: 'session-token', expiresAt: 1_700_000 },
    });
    const auth = createLoontailAuth(api({ login }));

    const result = await auth.signIn({ identifier: 'someone', password: 'pw' });

    expect(result).toMatchObject({
      ok: true,
      identity: { apiSession: { expiresAt: 1_700_000_000 } },
    });
  });

  it('keeps the expiry unknown when the server sends an unparsable value', async () => {
    const response = authResponse();
    const login = vi
      .fn()
      .mockResolvedValue({ ...response, session: { token: 'session-token', expiresAt: 'soon' } });
    const auth = createLoontailAuth(api({ login }));

    expect(await auth.signIn({ identifier: 'someone', password: 'pw' })).toMatchObject({
      ok: true,
      identity: { apiSession: { expiresAt: null } },
    });
  });
});

describe('createLoontailAuth.validate', () => {
  it('returns the account without rotating the session', async () => {
    const me = vi.fn().mockResolvedValue({ username: 'someone', email: 'someone@example.com' });
    const refresh = vi.fn();
    const auth = createLoontailAuth(api({ me, refresh }));

    expect(await auth.validate('session-token')).toEqual({
      kind: 'ok',
      account: {
        provider: 'yggdrasil',
        username: 'someone',
        email: 'someone@example.com',
        skin: null,
        cape: null,
      },
    });
    expect(me).toHaveBeenCalledWith('session-token');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports expired only on an explicit credential rejection', async () => {
    const me = vi.fn().mockRejectedValue(new AuthApiError(401, 'nope'));
    const auth = createLoontailAuth(api({ me }));

    expect(await auth.validate('session-token')).toEqual({ kind: 'expired' });
  });

  it('keeps the session on a server error rather than signing the user out', async () => {
    const me = vi.fn().mockRejectedValue(new AuthApiError(503, 'down'));
    const auth = createLoontailAuth(api({ me }));

    expect(await auth.validate('session-token')).toEqual({ kind: 'offline' });
  });

  it('keeps the session on a transport error', async () => {
    const me = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const auth = createLoontailAuth(api({ me }));

    expect(await auth.validate('session-token')).toEqual({ kind: 'offline' });
  });
});

describe('createLoontailAuth.signOut', () => {
  it('swallows a failing server logout', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('down'));
    const auth = createLoontailAuth(api({ logout }));

    await expect(auth.signOut('session-token')).resolves.toBeUndefined();
    expect(logout).toHaveBeenCalledWith('session-token');
  });
});
