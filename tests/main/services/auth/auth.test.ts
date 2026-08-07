import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestRouter } from '../../../helpers/router';

const storeMocks = vi.hoisted(() => {
  let session: unknown = null;
  let sessionToken: string | null = null;
  return {
    setSession: (next: unknown) => {
      session = next;
    },
    setToken: (next: string | null) => {
      sessionToken = next;
    },
    getSession: () => session,
    getStoredAuth: vi.fn(() => session),
    getStoredSessionToken: vi.fn(() => sessionToken),
    setStoredAuth: vi.fn((next: unknown) => {
      session = next;
    }),
    clearStoredAuth: vi.fn(() => {
      session = null;
      sessionToken = null;
    }),
  };
});

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

vi.mock('@main/infra/store', () => ({
  getStoredAuth: storeMocks.getStoredAuth,
  getStoredSessionToken: storeMocks.getStoredSessionToken,
  setStoredAuth: storeMocks.setStoredAuth,
  clearStoredAuth: storeMocks.clearStoredAuth,
}));

vi.mock('@main/services/auth/verify', () => ({
  enrichYggdrasilAccount: vi.fn(),
  verifySession: vi.fn(),
}));

import { login, logout } from '@main/services/auth/auth';
import type { LoontailAuth } from '@main/services/auth/loontailAuth';
import { type MojangAuth, MojangBrowserOpenError } from '@main/services/auth/mojangAuth';
import { registerAuthRoutes } from '@main/services/auth/routes';
import { enrichYggdrasilAccount } from '@main/services/auth/verify';
import {
  LOGIN_ERROR_CODE,
  type MojangSession,
  type YggdrasilSession,
} from '@shared/contracts/auth';
import { IPC_CHANNELS } from '@shared/ipc';

const yggdrasilSession = (): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: 'access-token',
  clientToken: 'client-token',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

const ACTIVE_SKIN_URL = 'https://textures.example/skins/active.png';

const mojangSessionWithSkin = (): MojangSession =>
  ({
    provider: 'mojang',
    accessToken: 'access',
    expiresAt: Date.UTC(2099, 0, 1),
    refreshToken: 'refresh',
    clientId: 'client',
    xuid: 'xuid',
    profile: {
      uuid: 'uuid',
      username: 'steve',
      skins: [{ state: 'ACTIVE', url: ACTIVE_SKIN_URL }],
    },
  }) as unknown as MojangSession;

const loontailAuth = (signOut: LoontailAuth['signOut']): LoontailAuth => ({
  signIn: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  validate: vi.fn(),
  signOut,
});

const mojangAuth = (overrides: Partial<MojangAuth> = {}): MojangAuth => ({
  signInWithMojang: vi.fn(),
  cancelMojangLogin: vi.fn(),
  verifyMojangSession: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.setSession(null);
  storeMocks.setToken(null);
});

describe('logout', () => {
  it('clears local auth without waiting for a hung Loontail sign-out', async () => {
    storeMocks.setSession(yggdrasilSession());
    storeMocks.setToken('session-token');
    const signOut = vi.fn(() => new Promise<void>(() => undefined));

    await expect(logout(loontailAuth(signOut))).resolves.toBeUndefined();

    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(storeMocks.getSession()).toBeNull();
    expect(signOut).toHaveBeenCalledWith('session-token');
  });

  it('skips the server sign-out when no session token is stored', async () => {
    storeMocks.setSession(yggdrasilSession());
    storeMocks.setToken(null);
    const signOut = vi.fn();

    await logout(loontailAuth(signOut));

    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('rejects with the coded failure instead of resolving an in-band {ok:false}', async () => {
    const auth = loontailAuth(vi.fn());
    vi.mocked(auth.signIn).mockResolvedValue({
      ok: false,
      error: LOGIN_ERROR_CODE.INVALID_CREDENTIALS,
    });

    await expect(
      login(auth, { identifier: 'someone', password: 'wrong' }, vi.fn()),
    ).rejects.toMatchObject({ code: LOGIN_ERROR_CODE.INVALID_CREDENTIALS });
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });
});

describe('registerAuthRoutes', () => {
  it('maps Microsoft browser-open failures to a renderer-visible login error', async () => {
    const { router, handlers } = createTestRouter();
    const signInWithMojang = vi
      .fn()
      .mockRejectedValue(new MojangBrowserOpenError('Failed to open browser'));

    registerAuthRoutes(router, loontailAuth(vi.fn()), mojangAuth({ signInWithMojang }), vi.fn(), {
      refresh: vi.fn(),
    });

    const handler = handlers.get(IPC_CHANNELS.authMojangSignIn);
    if (!handler) throw new Error('auth.mojangSignIn handler was not registered');

    await expect(handler(undefined)).rejects.toMatchObject({
      code: LOGIN_ERROR_CODE.BROWSER_OPEN_FAILED,
    });
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('returns the active Mojang skin without enriching via the Yggdrasil path', async () => {
    const { router, handlers } = createTestRouter();
    const session = mojangSessionWithSkin();
    const signInWithMojang = vi.fn().mockResolvedValue(session);

    registerAuthRoutes(router, loontailAuth(vi.fn()), mojangAuth({ signInWithMojang }), vi.fn(), {
      refresh: vi.fn(),
    });

    const handler = handlers.get(IPC_CHANNELS.authMojangSignIn);
    if (!handler) throw new Error('auth.mojangSignIn handler was not registered');

    await expect(handler(undefined)).resolves.toEqual({
      provider: 'mojang',
      username: 'steve',
      email: null,
      skin: ACTIVE_SKIN_URL,
      cape: null,
    });
    expect(storeMocks.setStoredAuth).toHaveBeenCalledWith(session);
    expect(enrichYggdrasilAccount).not.toHaveBeenCalled();
  });
});
