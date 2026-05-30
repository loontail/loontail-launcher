import {
  type AuthorizationCodeRunOptions,
  type MojangSession as KitMojangSession,
  type MinecraftKit,
  MinecraftKitError,
  type MinecraftProfile,
} from '@loontail/minecraft-kit';
import type { MojangSession } from '@shared/contracts/auth';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  process.env.MOJANG_CLIENT_ID ??= '00000000-0000-0000-0000-000000000000';
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { MOJANG_BROWSER_OPEN_ERROR_CODE, createMojangAuth } from '@main/services/auth/mojangAuth';

const FAR_FUTURE = Date.UTC(2099, 0, 1);
const MICROSOFT_AUTHORIZE_URL =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=00000000-0000-0000-0000-000000000000';

// The mojang `as*` helpers validate GUID/UUID shape at runtime; the test never
// goes near the refresh path so we cast a plain literal session — the verify
// path only consumes `accessToken`.
const baseSession = (): MojangSession =>
  ({
    provider: 'mojang',
    accessToken: 'access',
    expiresAt: FAR_FUTURE,
    refreshToken: 'refresh',
    clientId: 'client',
    xuid: 'xuid',
    profile: { uuid: 'uuid', username: 'name', skins: [] },
  }) as unknown as MojangSession;

const fakeProfile = (): MinecraftProfile =>
  ({
    uuid: 'uuid',
    username: 'name',
    skins: [],
  }) as unknown as MinecraftProfile;

// Build a fake kit object that only implements the surface mojangAuth.ts
// uses. Lets the test swap in a fake without going through `vi.mock` on
// the whole `@loontail/minecraft-kit` module.
type FakeKitOverrides = {
  read?: (args: { accessToken: string }) => Promise<MinecraftProfile>;
  run?: (options: AuthorizationCodeRunOptions) => Promise<KitMojangSession>;
  refresh?: (refreshToken: string, options: { clientId: string }) => Promise<KitMojangSession>;
};
const fakeKit = (overrides: FakeKitOverrides = {}): MinecraftKit =>
  ({
    auth: {
      authorizationCode: {
        run: overrides.run ?? vi.fn(),
      },
      profile: {
        read: overrides.read ?? vi.fn().mockResolvedValue(fakeProfile()),
      },
      refresh: overrides.refresh ?? vi.fn(),
    },
  }) as unknown as MinecraftKit;

// expiresAt in the past forces verifyMojangSession down the refresh branch
// (needsRefresh = now > expiresAt - 60s).
const expiringSession = (): MojangSession =>
  ({
    provider: 'mojang',
    accessToken: 'access',
    expiresAt: Date.UTC(2001, 0, 1),
    refreshToken: 'refresh',
    clientId: 'client',
    xuid: 'xuid',
    profile: { uuid: 'uuid', username: 'name', skins: [] },
  }) as unknown as MojangSession;

const refreshedKitSession = (): KitMojangSession =>
  ({
    minecraft: {
      accessToken: 'fresh-access',
      expiresAt: FAR_FUTURE,
      uuid: 'uuid',
      username: 'name',
      xuid: 'xuid',
      skins: [],
    },
    microsoft: { refreshToken: 'fresh-refresh', clientId: 'client' },
  }) as unknown as KitMojangSession;

describe('createMojangAuth.signInWithMojang', () => {
  it('aborts the sign-in flow when the browser opener rejects', async () => {
    let capturedSignal: AbortSignal | undefined;
    const openError = new Error('browser blocked');
    const openExternal = vi.fn().mockRejectedValue(openError);
    const run = vi.fn(async (options: AuthorizationCodeRunOptions): Promise<KitMojangSession> => {
      capturedSignal = options.signal;
      await options.onOpenBrowser(MICROSOFT_AUTHORIZE_URL);
      throw new Error('sign-in should not continue after browser failure');
    });
    const mojangAuth = createMojangAuth(fakeKit({ run }), { openExternal });

    await expect(mojangAuth.signInWithMojang()).rejects.toMatchObject({
      code: MOJANG_BROWSER_OPEN_ERROR_CODE,
      cause: openError,
    });

    expect(openExternal).toHaveBeenCalledWith(MICROSOFT_AUTHORIZE_URL);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('rejects non-HTTPS authorize URLs before opening the system browser', async () => {
    let capturedSignal: AbortSignal | undefined;
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn(async (options: AuthorizationCodeRunOptions): Promise<KitMojangSession> => {
      capturedSignal = options.signal;
      await options.onOpenBrowser(MICROSOFT_AUTHORIZE_URL.replace('https:', 'http:'));
      throw new Error('sign-in should not continue after invalid authorize URL');
    });
    const mojangAuth = createMojangAuth(fakeKit({ run }), { openExternal });

    await expect(mojangAuth.signInWithMojang()).rejects.toMatchObject({
      code: MOJANG_BROWSER_OPEN_ERROR_CODE,
    });

    expect(openExternal).not.toHaveBeenCalled();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('createMojangAuth.verifyMojangSession', () => {
  it('returns ok when the kit profile read succeeds', async () => {
    const read = vi.fn().mockResolvedValue(fakeProfile());
    const mojangAuth = createMojangAuth(fakeKit({ read }));
    const result = await mojangAuth.verifyMojangSession(baseSession());
    expect(read).toHaveBeenCalledWith({ accessToken: 'access' });
    expect(result.kind).toBe('ok');
  });

  it('reports expired when the kit returns AUTH_MINECRAFT_FAILED with 401', async () => {
    const error = new MinecraftKitError('AUTH_MINECRAFT_FAILED', '401');
    (error as unknown as { context: { httpStatus: number } }).context = { httpStatus: 401 };
    const mojangAuth = createMojangAuth(fakeKit({ read: vi.fn().mockRejectedValue(error) }));
    const result = await mojangAuth.verifyMojangSession(baseSession());
    expect(result.kind).toBe('expired');
  });

  it('falls back to offline on an opaque kit failure', async () => {
    const mojangAuth = createMojangAuth(
      fakeKit({ read: vi.fn().mockRejectedValue(new Error('network down')) }),
    );
    const result = await mojangAuth.verifyMojangSession(baseSession());
    expect(result.kind).toBe('offline');
  });

  it('refreshes a near-expiry session instead of reading the profile', async () => {
    const refresh = vi.fn().mockResolvedValue(refreshedKitSession());
    const read = vi.fn();
    const mojangAuth = createMojangAuth(fakeKit({ refresh, read }));

    const result = await mojangAuth.verifyMojangSession(expiringSession());

    expect(refresh).toHaveBeenCalledWith('refresh', { clientId: 'client' });
    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: 'ok',
      session: expect.objectContaining({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
      }),
    });
  });

  it('reports expired when refresh fails with AUTH_REFRESH_FAILED', async () => {
    const refresh = vi.fn().mockRejectedValue(new MinecraftKitError('AUTH_REFRESH_FAILED', 'gone'));
    const mojangAuth = createMojangAuth(fakeKit({ refresh }));

    const result = await mojangAuth.verifyMojangSession(expiringSession());

    expect(result.kind).toBe('expired');
  });
});
