import type { MojangAuth, VerifyMojangResult } from '@main/services/auth/mojangAuth';
import type { VerifyYggdrasilResult, YggdrasilAuth } from '@main/services/auth/yggdrasilAuth';
import type { MojangSession, YggdrasilSession } from '@shared/contracts/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getStoredAuth: vi.fn(),
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

const yggAuth = (result?: VerifyYggdrasilResult): YggdrasilAuth =>
  ({
    verifySession: vi.fn().mockResolvedValue(result),
  }) as unknown as YggdrasilAuth;

const mojangAuth = (result?: VerifyMojangResult): MojangAuth =>
  ({
    verifyMojangSession: vi.fn().mockResolvedValue(result),
  }) as unknown as MojangAuth;

beforeEach(() => {
  storeMocks.getStoredAuth.mockReset();
  storeMocks.setStoredAuth.mockReset();
  storeMocks.clearStoredAuth.mockReset();
  fetchTexturesMock.mockReset();
  fetchTexturesMock.mockResolvedValue({ skin: null, cape: null });
});

afterEach(() => {
  loggerMocks.warn.mockClear();
});

describe('verifySession', () => {
  it('returns null without touching a provider when no session is stored', async () => {
    storeMocks.getStoredAuth.mockReturnValue(null);
    const ygg = yggAuth();

    expect(await verifySession(ygg, mojangAuth(), fetchTexturesMock)).toBeNull();
    expect(ygg.verifySession).not.toHaveBeenCalled();
  });

  it('clears the session and returns null when yggdrasil reports expired', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    expect(
      await verifySession(yggAuth({ kind: 'expired' }), mojangAuth(), fetchTexturesMock),
    ).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
  });

  it('keeps the cached yggdrasil account without a network fetch when offline', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    const account = await verifySession(
      yggAuth({ kind: 'offline' }),
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

  it('keeps the cached yggdrasil account and warns on a server error', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());

    const account = await verifySession(
      yggAuth({ kind: 'server-error' }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toMatchObject({ provider: 'yggdrasil', username: 'someone' });
    expect(fetchTexturesMock).not.toHaveBeenCalled();
    expect(storeMocks.setStoredAuth).not.toHaveBeenCalled();
    expect(storeMocks.clearStoredAuth).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });

  it('enriches the rotated yggdrasil account with textures on success', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const rotated = yggdrasilSession('rotated-access');
    fetchTexturesMock.mockResolvedValue({
      skin: { url: 'https://skins/s' },
      cape: { url: 'https://capes/c' },
    });

    const account = await verifySession(
      yggAuth({ kind: 'ok', session: rotated }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toEqual({
      provider: 'yggdrasil',
      username: 'someone',
      email: null,
      skin: 'https://skins/s',
      cape: 'https://capes/c',
    });
    expect(fetchTexturesMock).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef');
  });

  it('persists the rotated yggdrasil session on success', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const rotated = yggdrasilSession('rotated-access');

    const account = await verifySession(
      yggAuth({ kind: 'ok', session: rotated }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(storeMocks.setStoredAuth).toHaveBeenCalledWith(rotated);
    expect(account).toEqual({
      provider: 'yggdrasil',
      username: 'someone',
      email: null,
      skin: null,
      cape: null,
    });
  });

  it('falls back to the bare profile when success-path texture enrichment fails', async () => {
    storeMocks.getStoredAuth.mockReturnValue(yggdrasilSession());
    const rotated = yggdrasilSession('rotated-access');
    fetchTexturesMock.mockRejectedValue(new Error('textures down'));

    const account = await verifySession(
      yggAuth({ kind: 'ok', session: rotated }),
      mojangAuth(),
      fetchTexturesMock,
    );

    expect(account).toMatchObject({ skin: null, cape: null });
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('clears the session and returns null when mojang reports expired', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());

    expect(
      await verifySession(yggAuth(), mojangAuth({ kind: 'expired' }), fetchTexturesMock),
    ).toBeNull();
    expect(storeMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached mojang account when offline without persisting', async () => {
    storeMocks.getStoredAuth.mockReturnValue(mojangSession());

    const account = await verifySession(
      yggAuth(),
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
      yggAuth(),
      mojangAuth({ kind: 'ok', session: rotated }),
      fetchTexturesMock,
    );

    expect(storeMocks.setStoredAuth).toHaveBeenCalledWith(rotated);
    expect(account).toMatchObject({ provider: 'mojang', username: 'rotated-player' });
  });
});
