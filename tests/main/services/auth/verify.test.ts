import type { AuthenticatedIdentity, RefreshResult } from '@main/services/auth/loontailAuth';
import type { MojangAuth, VerifyMojangResult } from '@main/services/auth/mojangAuth';
import type { SessionRefresher } from '@main/services/auth/sessionRefresh';
import type { MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getStoredAuth: vi.fn(),
  getStoredSessionToken: vi.fn(),
  setStoredAuth: vi.fn(),
  clearStoredAuth: vi.fn(),
}));

const fetchTexturesMock = vi.hoisted(() => vi.fn());

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/store', () => ({
  getStoredAuth: storeMocks.getStoredAuth,
  getStoredSessionToken: storeMocks.getStoredSessionToken,
  setStoredAuth: storeMocks.setStoredAuth,
  clearStoredAuth: storeMocks.clearStoredAuth,
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

import { verifySession } from '@main/services/auth/verify';

const yggdrasilSession = (token = 'access'): YggdrasilSession => ({
  provider: 'yggdrasil',
  accessToken: token,
  clientToken: 'client',
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
});

const identity = (
  token = 'rotated-access',
  sessionToken = 'rotated-session',
): AuthenticatedIdentity => ({
  session: yggdrasilSession(token),
  sessionToken,
  account: {
    provider: 'yggdrasil',
    username: 'someone',
    email: 'who@example.com',
    skin: null,
    cape: null,
  },
});

const mojangSession = (username = 'player'): MojangSession =>
  ({
    provider: 'mojang',
    accessToken: 'access',
    expiresAt: Date.UTC(2099, 0, 1),
    refreshToken: 'refresh',
    clientId: 'client',
    xuid: 'xuid',
    profile: { uuid: 'uuid', username, skins: [] },
  }) as unknown as MojangSession;

// The shared refresher owns the rotate + setStoredAuth; verifySession only
// consumes its RefreshResult, so the mock returns the result directly.
const refresher = (result?: RefreshResult): SessionRefresher => ({
  refresh: vi.fn().mockResolvedValue(result),
});

const mojangAuth = (result?: VerifyMojangResult): MojangAuth =>
  ({
    verifyMojangSession: vi.fn().mockResolvedValue(result),
  }) as unknown as MojangAuth;

beforeEach(() => {
  storeMocks.getStoredAuth.mockReset();
  storeMocks.getStoredSessionToken.mockReset();
  storeMocks.setStoredAuth.mockReset();
  storeMocks.clearStoredAuth.mockReset();
  storeMocks.getStoredSessionToken.mockReturnValue('session-token');
  fetchTexturesMock.mockReset();
  fetchTexturesMock.mockResolvedValue({ skin: null, cape: null });
});

afterEach(() => {
  loggerMocks.warn.mockClear();
});

describe('verifySession', () => {
  it('returns null without touching a provider when no session is stored', async () => {
    storeMocks.getStoredAuth.mockReturnValue(null);
    const ref = refresher();

    expect(await verifySession(ref, mojangAuth(), fetchTexturesMock)).toBeNull();
    expect(ref.refresh).not.toHaveBeenCalled();
  });

  it('clears the session and returns null when no API bearer is stored', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    storeMocks.getStoredSessionToken.mockReturnValue(null);
    const ref = refresher();

    expect(await verifySession(ref, mojangAuth(), fetchTexturesMock)).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(ref.refresh).not.toHaveBeenCalled();
  });

  it('clears the session and returns null when refresh reports expired', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    expect(
      await verifySession(refresher({ kind: 'expired' }), mojangAuth(), fetchTexturesMock),
    ).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('keeps the cached yggdrasil account without a network fetch when offline', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    const account = await verifySession(
      refresher({ kind: 'offline' }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toEqual({
      provider: 'yggdrasil',
      username: 'someone',
      email: null,
      skin: null,
      cape: null,
    });
    expect(fetchTexturesMock).not.toHaveBeenCalled();
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
    expect(storeMocks.clearStoredAuth).not.toHaveBeenCalled();
  });

  it('enriches the rotated yggdrasil account with textures on success', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock.mockResolvedValue({
      skin: { url: 'https://skins/s' },
      cape: { url: 'https://capes/c' },
    });

    const account = await verifySession(
      refresher({ kind: 'ok', identity: identity() }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toEqual({
      provider: 'yggdrasil',
      username: 'someone',
      email: 'who@example.com',
      skin: 'https://skins/s',
      cape: 'https://capes/c',
    });
    expect(fetchTexturesMock).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef');
  });

  it('delegates persistence to the shared refresher (no direct setStoredAuth) on success', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const ref = refresher({ kind: 'ok', identity: identity() });

    await verifySession(ref, mojangAuth(), fetchTexturesMock);

    // The refresher owns the rotate + setStoredAuth; verifySession must not
    // persist the yggdrasil session itself (BUG-1: one rotation, one writer).
    expect(ref.refresh).toHaveBeenCalledTimes(1);
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('falls back to the bare account when success-path texture enrichment fails', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock.mockRejectedValue(new Error('textures down'));

    const account = await verifySession(
      refresher({ kind: 'ok', identity: identity() }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toMatchObject({ skin: null, cape: null });
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('clears the session and returns null when mojang reports expired', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());

    expect(
      await verifySession(refresher(), mojangAuth({ kind: 'expired' }), fetchTexturesMock),
    ).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached mojang account when offline without persisting', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());

    const account = await verifySession(
      refresher(),
      mojangAuth({ kind: 'offline' }),
      fetchTexturesMock,
    );

    expect(account).toMatchObject({ provider: 'mojang', username: 'player' });
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
    expect(fetchTexturesMock).not.toHaveBeenCalled();
  });

  it('persists the rotated mojang session on success', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());
    const rotated = mojangSession('rotated-player');

    const account = await verifySession(
      refresher(),
      mojangAuth({ kind: 'ok', session: rotated }),
      fetchTexturesMock,
    );

    expect(storeMocks.setStoredAuth).toHaveBeenCalledWith(rotated);
    expect(account).toMatchObject({ provider: 'mojang', username: 'rotated-player' });
  });
});
