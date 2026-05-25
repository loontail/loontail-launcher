import { MojangSessionSchema, StrapiSessionSchema, StrapiUserSchema } from '@shared/contracts/auth';
import { asClientSlug } from '@shared/contracts/ids';
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

describe('StrapiSessionSchema', () => {
  it('round-trips a valid session', () => {
    const session = {
      provider: 'strapi' as const,
      jwt: 'a.b.c',
      user: {
        id: 1,
        username: 'someone',
        email: 'someone@example.com',
        blocked: false,
      },
    };
    const parsed = StrapiSessionSchema.parse(session);
    expect(parsed.provider).toBe('strapi');
    expect(parsed.user.email).toBe('someone@example.com');
  });

  it('rejects an empty jwt', () => {
    const result = StrapiSessionSchema.safeParse({
      provider: 'strapi',
      jwt: '',
      user: { id: 1, username: 'a', email: 'a@b.c', blocked: false },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = StrapiUserSchema.safeParse({
      id: 1,
      username: 'a',
      email: 'not-an-email',
      blocked: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects the wrong provider literal', () => {
    const result = StrapiSessionSchema.safeParse({
      provider: 'mojang',
      jwt: 'a.b.c',
      user: { id: 1, username: 'a', email: 'a@b.c', blocked: false },
    });
    expect(result.success).toBe(false);
  });
});

describe('MojangSessionSchema', () => {
  // The shared schema brands strings without validating their format — kit's
  // runtime `as*` guards can't be imported into shared (they drag Node-only
  // modules into the renderer bundle), so brand checks live at the kit-call
  // boundary in main instead.
  const clientId = '11111111-2222-3333-4444-555555555555';
  const playerUuid = '00000000-1111-2222-3333-444444444444';

  it('round-trips a valid session', () => {
    const session = {
      provider: 'mojang' as const,
      accessToken: 'token',
      expiresAt: 1_700_000_000,
      refreshToken: 'refresh-token',
      clientId,
      xuid: 'xuid-value',
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
    };
    const parsed = MojangSessionSchema.parse(session);
    expect(parsed.profile.username).toBe('player');
    expect(parsed.profile.skins[0]?.state).toBe('ACTIVE');
  });

  it('rejects a non-string client id', () => {
    const result = MojangSessionSchema.safeParse({
      provider: 'mojang',
      accessToken: 'token',
      expiresAt: 0,
      refreshToken: 'refresh',
      clientId: 12345,
      xuid: 'xuid',
      profile: { uuid: playerUuid, username: 'p', skins: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown skin variant', () => {
    const result = MojangSessionSchema.safeParse({
      provider: 'mojang',
      accessToken: 'token',
      expiresAt: 0,
      refreshToken: 'refresh',
      clientId,
      xuid: 'xuid',
      profile: {
        uuid: playerUuid,
        username: 'p',
        skins: [{ id: 'x', state: 'ACTIVE', url: 'u', variant: 'UNKNOWN' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects expiresAt that is not a number', () => {
    const result = MojangSessionSchema.safeParse({
      provider: 'mojang',
      accessToken: 'token',
      expiresAt: 'soon',
      refreshToken: 'refresh',
      clientId,
      xuid: 'xuid',
      profile: { uuid: playerUuid, username: 'p', skins: [] },
    });
    expect(result.success).toBe(false);
  });
});
