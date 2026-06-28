import type {
  AuthenticatedIdentity,
  LoontailAuth,
  RefreshResult,
} from '@main/services/auth/loontailAuth';
import type { YggdrasilSession } from '@shared/contracts/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getStoredAuth: vi.fn(),
  getStoredSessionToken: vi.fn(),
  setStoredAuth: vi.fn(),
}));

vi.mock('@main/infra/store', () => ({
  getStoredAuth: storeMocks.getStoredAuth,
  getStoredSessionToken: storeMocks.getStoredSessionToken,
  setStoredAuth: storeMocks.setStoredAuth,
}));

import { createSessionRefresher } from '@main/services/auth/sessionRefresh';

const yggdrasilSession = (): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: 'access',
  clientToken: 'client',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

const identity = (sessionToken = 'rotated-session'): AuthenticatedIdentity => ({
  session: yggdrasilSession(),
  sessionToken,
  account: { provider: 'yggdrasil', username: 'someone', email: null, skin: null, cape: null },
});

const loontailAuth = (refresh: LoontailAuth['refresh']): LoontailAuth =>
  ({ refresh }) as unknown as LoontailAuth;

beforeEach(() => {
  storeMocks.getStoredAuth.mockReset().mockReturnValue(yggdrasilSession());
  storeMocks.getStoredSessionToken.mockReset().mockReturnValue('stale-session');
  storeMocks.setStoredAuth.mockReset();
});

describe('createSessionRefresher', () => {
  it('de-duplicates concurrent refreshes into one rotation and one setStoredAuth', async () => {
    let resolveRefresh: (result: RefreshResult) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<RefreshResult>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const refresher = createSessionRefresher(loontailAuth(refresh));

    const a = refresher.refresh();
    const b = refresher.refresh();
    expect(a).toBe(b); // same in-flight promise
    resolveRefresh({ kind: 'ok', identity: identity() });
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe(rb);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(storeMocks.setStoredAuth).toHaveBeenCalledTimes(1);
  });

  it('clears the memo after settling so a later genuine refresh fires again', async () => {
    const refresh = vi.fn().mockResolvedValue({ kind: 'ok', identity: identity() });
    const refresher = createSessionRefresher(loontailAuth(refresh));

    await refresher.refresh();
    await refresher.refresh();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('re-reads the freshest stored token at fire time, not a caller snapshot', async () => {
    storeMocks.getStoredSessionToken.mockReturnValue('fresh-session');
    const refresh = vi.fn().mockResolvedValue({ kind: 'ok', identity: identity() });
    const refresher = createSessionRefresher(loontailAuth(refresh));

    await refresher.refresh();

    expect(refresh).toHaveBeenCalledWith('fresh-session');
  });

  it('returns expired without rotating when no yggdrasil session is stored', async () => {
    storeMocks.getStoredAuth.mockReturnValue(null);
    const refresh = vi.fn();
    const refresher = createSessionRefresher(loontailAuth(refresh));

    await expect(refresher.refresh()).resolves.toEqual({ kind: 'expired' });
    expect(refresh).not.toHaveBeenCalled();
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('does not persist on a non-ok refresh result', async () => {
    const refresh = vi.fn().mockResolvedValue({ kind: 'offline' });
    const refresher = createSessionRefresher(loontailAuth(refresh));

    await expect(refresher.refresh()).resolves.toEqual({ kind: 'offline' });
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });
});
