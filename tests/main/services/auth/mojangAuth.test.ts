import {
  asAzureClientId,
  asMicrosoftRefreshToken,
  asPlayerUuid,
  type MinecraftKit,
  MinecraftKitError,
  type MinecraftProfile,
} from '@loontail/minecraft-kit';
import type { MojangSession } from '@shared/contracts/auth';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { createMojangAuth } from '@main/services/auth/mojangAuth';

const FAR_FUTURE = Date.UTC(2099, 0, 1);

const baseSession = (): MojangSession => ({
  provider: 'mojang',
  accessToken: 'access',
  expiresAt: FAR_FUTURE,
  refreshToken: asMicrosoftRefreshToken('refresh'),
  clientId: asAzureClientId('client'),
  xuid: 'xuid',
  profile: { uuid: asPlayerUuid('uuid'), username: 'name', skins: [] },
});

const fakeProfile = (): MinecraftProfile => ({
  uuid: asPlayerUuid('uuid'),
  username: 'name',
  skins: [],
});

// Build a fake kit object that only implements the surface mojangAuth.ts
// uses. Lets the test swap in a fake without going through `vi.mock` on
// the whole `@loontail/minecraft-kit` module.
type FakeKitOverrides = {
  read?: (args: { accessToken: string }) => Promise<MinecraftProfile>;
};
const fakeKit = (overrides: FakeKitOverrides = {}): MinecraftKit =>
  ({
    auth: {
      profile: {
        read: overrides.read ?? vi.fn().mockResolvedValue(fakeProfile()),
      },
    },
  }) as unknown as MinecraftKit;

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
});
