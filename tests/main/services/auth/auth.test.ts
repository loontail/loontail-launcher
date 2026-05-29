import type { Router } from '@main/ipc/router';
import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  process.env.MOJANG_CLIENT_ID ??= '00000000-0000-0000-0000-000000000000';
});

const storeMocks = vi.hoisted(() => {
  let session: unknown = null;
  return {
    setSession: (next: unknown) => {
      session = next;
    },
    getSession: () => session,
    getStoredAuth: vi.fn(() => session),
    setStoredAuth: vi.fn((next: unknown) => {
      session = next;
    }),
    clearStoredAuth: vi.fn(() => {
      session = null;
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
  setStoredAuth: storeMocks.setStoredAuth,
  clearStoredAuth: storeMocks.clearStoredAuth,
}));

vi.mock('@main/services/auth/verify', () => ({
  enrichYggdrasilAccount: vi.fn(),
  verifySession: vi.fn(),
}));

import { logout } from '@main/services/auth/auth';
import { type MojangAuth, MojangBrowserOpenError } from '@main/services/auth/mojangAuth';
import { registerAuthRoutes } from '@main/services/auth/routes';
import type { YggdrasilAuth } from '@main/services/auth/yggdrasilAuth';
import { LOGIN_ERROR_CODE, type YggdrasilSession } from '@shared/contracts/auth';
import { IPC_CHANNELS, type IpcArgs, type IpcContract, type IpcResult } from '@shared/ipc';

type StoredHandler = (rawArgs: unknown) => Promise<unknown> | unknown;

const fakeEvent = (): IpcMainInvokeEvent => ({}) as unknown as IpcMainInvokeEvent;

const createTestRouter = (): { router: Router; handlers: Map<string, StoredHandler> } => {
  const handlers = new Map<string, StoredHandler>();
  const router: Router = {
    handle<TChannel extends keyof IpcContract>(
      channel: TChannel,
      handler: (
        args: IpcArgs<TChannel>,
        event: IpcMainInvokeEvent,
      ) => Promise<IpcResult<TChannel>> | IpcResult<TChannel>,
    ): void {
      handlers.set(channel, (rawArgs) => handler(rawArgs as IpcArgs<TChannel>, fakeEvent()));
    },
    dispose: () => undefined,
  };
  return { router, handlers };
};

const yggdrasilSession = (): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: 'access-token',
  clientToken: 'client-token',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

const yggdrasilAuth = (signOut: YggdrasilAuth['signOut']): YggdrasilAuth => ({
  signIn: vi.fn(),
  verifySession: vi.fn(),
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
});

describe('logout', () => {
  it('clears local auth without waiting for a hung Yggdrasil invalidate', async () => {
    const session = yggdrasilSession();
    const signOut = vi.fn(() => new Promise<void>(() => undefined));
    storeMocks.setSession(session);

    await expect(logout(yggdrasilAuth(signOut))).resolves.toBeUndefined();

    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(storeMocks.getSession()).toBeNull();
    expect(signOut).toHaveBeenCalledWith(session);
  });

  it('logs a warning when the best-effort sign-out rejects late', async () => {
    const error = new Error('network down');
    const signOut = vi.fn().mockRejectedValue(error);
    storeMocks.setSession(yggdrasilSession());

    await logout(yggdrasilAuth(signOut));
    await Promise.resolve();

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Yggdrasil sign-out cleanup failed after local logout',
      error,
    );
  });
});

describe('registerAuthRoutes', () => {
  it('maps Microsoft browser-open failures to a renderer-visible login error', async () => {
    const { router, handlers } = createTestRouter();
    const signInWithMojang = vi
      .fn()
      .mockRejectedValue(new MojangBrowserOpenError('Failed to open browser'));

    registerAuthRoutes(router, yggdrasilAuth(vi.fn()), mojangAuth({ signInWithMojang }));

    const handler = handlers.get(IPC_CHANNELS.authMojangSignIn);
    if (!handler) throw new Error('auth.mojangSignIn handler was not registered');

    await expect(handler(undefined)).resolves.toEqual({
      ok: false,
      error: LOGIN_ERROR_CODE.BrowserOpenFailed,
    });
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });
});
