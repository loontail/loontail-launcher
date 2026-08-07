import type {
  AuthenticatedIdentity,
  RefreshResult,
  ValidateResult,
  ValidateSession,
} from '@main/services/auth/loontailAuth';
import type { MojangAuth, VerifyMojangResult } from '@main/services/auth/mojangAuth';
import type { SessionRefresher } from '@main/services/auth/sessionRefresh';
import type { MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getStoredAuth: vi.fn(),
  getStoredApiSession: vi.fn(),
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
  getStoredApiSession: storeMocks.getStoredApiSession,
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
  apiSession: { token: sessionToken, expiresAt: null },
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

const validator = (result?: ValidateResult): ValidateSession => vi.fn().mockResolvedValue(result);

const HOUR_MS = 60 * 60 * 1000;

const mojangAuth = (result?: VerifyMojangResult): MojangAuth =>
  ({
    verifyMojangSession: vi.fn().mockResolvedValue(result),
  }) as unknown as MojangAuth;

beforeEach(() => {
  storeMocks.getStoredAuth.mockReset();
  storeMocks.getStoredApiSession.mockReset();
  storeMocks.setStoredAuth.mockReset();
  storeMocks.clearStoredAuth.mockReset();
  // A null expiry is the pre-migration shape: unknown → rotate once.
  storeMocks.getStoredApiSession.mockReturnValue({ token: 'session-token', expiresAt: null });
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

    expect(await verifySession(ref, validator(), mojangAuth(), fetchTexturesMock)).toBeNull();
    expect(ref.refresh).not.toHaveBeenCalled();
  });

  it('clears the session and returns null when no API bearer is stored', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    storeMocks.getStoredApiSession.mockReturnValue(null);
    const ref = refresher();

    expect(await verifySession(ref, validator(), mojangAuth(), fetchTexturesMock)).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(ref.refresh).not.toHaveBeenCalled();
  });

  it('clears the session and returns null when refresh reports expired', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    expect(
      await verifySession(
        refresher({ kind: 'expired' }),
        validator(),
        mojangAuth(),
        fetchTexturesMock,
      ),
    ).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('keeps the cached yggdrasil account without a network fetch when offline', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    const account = await verifySession(
      refresher({ kind: 'offline' }),
      validator(),
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
      validator(),
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

    await verifySession(ref, validator(), mojangAuth(), fetchTexturesMock);

    // The refresher owns the rotate + setStoredAuth; verifySession must not
    // persist the yggdrasil session itself: one rotation, one writer.
    expect(ref.refresh).toHaveBeenCalledTimes(1);
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('falls back to the bare account when success-path texture enrichment fails', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    fetchTexturesMock.mockRejectedValue(new Error('textures down'));

    const account = await verifySession(
      refresher({ kind: 'ok', identity: identity() }),
      validator(),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toMatchObject({ skin: null, cape: null });
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  // CON-06: rotation revokes the bearer the running game was handed at launch,
  // so a session nowhere near expiry must be validated, never rotated.
  it('validates without rotating when the stored session is far from expiry', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    storeMocks.getStoredApiSession.mockReturnValue({
      token: 'session-token',
      expiresAt: Date.now() + 20 * HOUR_MS,
    });
    const ref = refresher();
    const validate = validator({
      kind: 'ok',
      account: {
        provider: 'yggdrasil',
        username: 'someone',
        email: 'who@example.com',
        skin: null,
        cape: null,
      },
    });

    const account = await verifySession(ref, validate, mojangAuth(), fetchTexturesMock);

    expect(ref.refresh).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledWith('session-token');
    expect(account).toMatchObject({ username: 'someone', email: 'who@example.com' });
    expect(storeMocks.clearStoredAuth).not.toHaveBeenCalled();
  });

  it('rotates exactly once when the stored session is near expiry', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    storeMocks.getStoredApiSession.mockReturnValue({
      token: 'session-token',
      expiresAt: Date.now() + HOUR_MS,
    });
    const ref = refresher({ kind: 'ok', identity: identity() });
    const validate = validator();

    await verifySession(ref, validate, mojangAuth(), fetchTexturesMock);

    expect(ref.refresh).toHaveBeenCalledTimes(1);
    expect(validate).not.toHaveBeenCalled();
  });

  it('rotates exactly once when the stored session has no expiry (pre-migration blob)', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const ref = refresher({ kind: 'ok', identity: identity() });
    const validate = validator();

    await verifySession(ref, validate, mojangAuth(), fetchTexturesMock);

    expect(ref.refresh).toHaveBeenCalledTimes(1);
    expect(validate).not.toHaveBeenCalled();
  });

  it('keeps the cached account without rotating when validation is inconclusive', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    storeMocks.getStoredApiSession.mockReturnValue({
      token: 'session-token',
      expiresAt: Date.now() + 20 * HOUR_MS,
    });
    const ref = refresher();

    const account = await verifySession(
      ref,
      validator({ kind: 'offline' }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toMatchObject({ provider: 'yggdrasil', username: 'someone' });
    expect(ref.refresh).not.toHaveBeenCalled();
    expect(fetchTexturesMock).not.toHaveBeenCalled();
    expect(storeMocks.clearStoredAuth).not.toHaveBeenCalled();
  });

  it('falls back to a rotation when the server rejects the validated token', async () => {
    // A concurrent rotation may have revoked the token this read observed; the
    // refresher re-reads the freshest one, so retry there before signing out.
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    storeMocks.getStoredApiSession.mockReturnValue({
      token: 'session-token',
      expiresAt: Date.now() + 20 * HOUR_MS,
    });
    const ref = refresher({ kind: 'ok', identity: identity() });

    const account = await verifySession(
      ref,
      validator({ kind: 'expired' }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(ref.refresh).toHaveBeenCalledTimes(1);
    expect(account).toMatchObject({ provider: 'yggdrasil', username: 'someone' });
  });

  it('clears the session and returns null when mojang reports expired', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());

    expect(
      await verifySession(
        refresher(),
        validator(),
        mojangAuth({ kind: 'expired' }),
        fetchTexturesMock,
      ),
    ).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached mojang account when offline without persisting', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());

    const account = await verifySession(
      refresher(),
      validator(),
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
      validator(),
      mojangAuth({ kind: 'ok', session: rotated }),
      fetchTexturesMock,
    );

    expect(storeMocks.setStoredAuth).toHaveBeenCalledWith(rotated);
    expect(account).toMatchObject({ provider: 'mojang', username: 'rotated-player' });
  });
});
