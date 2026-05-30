import { MojangSessionSchema, YggdrasilSessionSchema } from '@shared/contracts/auth';
import {
  BundleErrorCodeSchema,
  BundleErrorCodes,
  BundleSyncStatusSchema,
  BundleSyncStatuses,
} from '@shared/contracts/bundle';
import { asClientSlug } from '@shared/contracts/ids';
import {
  InstallStatusSchema,
  InstallStatuses,
  MinecraftErrorCodeSchema,
  MinecraftErrorCodes,
  ProgressStageSchema,
  ProgressStages,
} from '@shared/contracts/minecraft';
import { LauncherSettingsSchema, LoaderChoices } from '@shared/contracts/settings';
import { describe, expect, it } from 'vitest';

describe('LauncherSettingsSchema', () => {
  it('round-trips a fully populated settings blob', () => {
    const input = {
      memory: { allocatedRamMb: 4096 },
      storage: { clientsFolder: '/games' },
      launch: { console: true, fullscreen: false },
      clients: {
        survival: {
          memory: { allocatedRamMb: 8192 },
          storage: { clientFolder: '/games/survival' },
          launch: { console: false, fullscreen: true },
          runtime: { component: 'java-runtime-gamma', path: '/jdk' },
          loader: LoaderChoices.FORGE,
        },
      },
    };
    const parsed = LauncherSettingsSchema.parse(input);
    expect(parsed.memory.allocatedRamMb).toBe(4096);
    const survival = parsed.clients[asClientSlug('survival')];
    expect(survival).toBeDefined();
    expect(survival?.loader).toBe(LoaderChoices.FORGE);
  });

  it('accepts an empty clients map and zero memory', () => {
    const result = LauncherSettingsSchema.safeParse({
      memory: { allocatedRamMb: 0 },
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative allocatedRamMb', () => {
    const result = LauncherSettingsSchema.safeParse({
      memory: { allocatedRamMb: -1 },
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer allocatedRamMb', () => {
    const result = LauncherSettingsSchema.safeParse({
      memory: { allocatedRamMb: 1024.5 },
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid loader choice in a client override', () => {
    const result = LauncherSettingsSchema.safeParse({
      memory: { allocatedRamMb: 0 },
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: { survival: { loader: 'optifine' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entirely missing top-level section', () => {
    const result = LauncherSettingsSchema.safeParse({
      storage: { clientsFolder: '' },
      launch: { console: false, fullscreen: false },
      clients: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('status/code enum schemas stay in sync with their const objects', () => {
  const ENUM_PAIRS = [
    {
      name: 'BundleSyncStatuses',
      values: BundleSyncStatuses,
      options: BundleSyncStatusSchema.options,
    },
    { name: 'BundleErrorCodes', values: BundleErrorCodes, options: BundleErrorCodeSchema.options },
    { name: 'InstallStatuses', values: InstallStatuses, options: InstallStatusSchema.options },
    { name: 'ProgressStages', values: ProgressStages, options: ProgressStageSchema.options },
    {
      name: 'MinecraftErrorCodes',
      values: MinecraftErrorCodes,
      options: MinecraftErrorCodeSchema.options,
    },
  ];

  it.each(ENUM_PAIRS)(
    '$name schema options exactly cover the const values',
    ({ values, options }) => {
      expect([...options].sort()).toEqual(Object.values(values).sort());
    },
  );
});

describe('YggdrasilSessionSchema', () => {
  const undashedUuid = '0123456789abcdef0123456789abcdef';

  it('round-trips a valid session', () => {
    const session = {
      provider: 'yggdrasil' as const,
      accessToken: 'access',
      clientToken: 'client',
      profile: { uuid: undashedUuid, name: 'someone' },
    };
    const parsed = YggdrasilSessionSchema.parse(session);
    expect(parsed.provider).toBe('yggdrasil');
    expect(parsed.profile.name).toBe('someone');
  });

  it('rejects empty tokens', () => {
    const result = YggdrasilSessionSchema.safeParse({
      provider: 'yggdrasil',
      accessToken: '',
      clientToken: 'client',
      profile: { uuid: undashedUuid, name: 'a' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a dashed profile uuid', () => {
    const result = YggdrasilSessionSchema.safeParse({
      provider: 'yggdrasil',
      accessToken: 'access',
      clientToken: 'client',
      profile: { uuid: '01234567-89ab-cdef-0123-456789abcdef', name: 'a' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects the wrong provider literal', () => {
    const result = YggdrasilSessionSchema.safeParse({
      provider: 'mojang',
      accessToken: 'access',
      clientToken: 'client',
      profile: { uuid: undashedUuid, name: 'a' },
    });
    expect(result.success).toBe(false);
  });
});

describe('MojangSessionSchema', () => {
  const clientId = '11111111-2222-3333-4444-555555555555';
  const playerUuid = '00000000-1111-2222-3333-444444444444';
  const expiresAt = Date.UTC(2099, 0, 1);

  const validSession = () => ({
    provider: 'mojang' as const,
    accessToken: 'token',
    expiresAt,
    refreshToken: 'refresh-token',
    clientId,
    xuid: '1234567890',
    profile: {
      uuid: playerUuid,
      username: 'player',
      skins: [
        {
          id: 'skin-id',
          state: 'ACTIVE' as const,
          url: 'https://textures.example/skin.png',
          variant: 'CLASSIC' as const,
        },
      ],
    },
  });

  it('round-trips a valid session', () => {
    const parsed = MojangSessionSchema.parse(validSession());
    expect(parsed.profile.username).toBe('player');
    expect(parsed.profile.skins[0]?.state).toBe('ACTIVE');
  });

  it('rejects a non-string client id', () => {
    const result = MojangSessionSchema.safeParse({
      ...validSession(),
      clientId: 12345,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown skin variant', () => {
    const result = MojangSessionSchema.safeParse({
      ...validSession(),
      profile: {
        uuid: playerUuid,
        username: 'p',
        skins: [
          {
            id: 'x',
            state: 'ACTIVE',
            url: 'https://textures.example/skin.png',
            variant: 'UNKNOWN',
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects expiresAt that is not a number', () => {
    const result = MojangSessionSchema.safeParse({
      ...validSession(),
      expiresAt: 'soon',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty token material', () => {
    expect(MojangSessionSchema.safeParse({ ...validSession(), accessToken: '' }).success).toBe(
      false,
    );
    expect(MojangSessionSchema.safeParse({ ...validSession(), refreshToken: '' }).success).toBe(
      false,
    );
  });

  it('rejects invalid profile identifiers and usernames', () => {
    expect(
      MojangSessionSchema.safeParse({
        ...validSession(),
        profile: { ...validSession().profile, uuid: '' },
      }).success,
    ).toBe(false);
    expect(
      MojangSessionSchema.safeParse({
        ...validSession(),
        profile: { ...validSession().profile, username: '' },
      }).success,
    ).toBe(false);
  });

  it('rejects non-millisecond expiresAt values', () => {
    expect(
      MojangSessionSchema.safeParse({ ...validSession(), expiresAt: 1_700_000_000 }).success,
    ).toBe(false);
    expect(
      MojangSessionSchema.safeParse({ ...validSession(), expiresAt: expiresAt + 0.5 }).success,
    ).toBe(false);
    expect(
      MojangSessionSchema.safeParse({ ...validSession(), expiresAt: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
  });
});
