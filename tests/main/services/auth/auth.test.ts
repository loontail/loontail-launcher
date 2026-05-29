import { describe, expect, it, vi } from 'vitest';

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
import type { YggdrasilAuth } from '@main/services/auth/yggdrasilAuth';
import type { YggdrasilSession } from '@shared/contracts/auth';

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
