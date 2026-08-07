import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpUserData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'mc-launcher-store-test-'));
});

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const safeStorageMocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptString: vi.fn((plainText: string) => Buffer.from(plainText, 'utf8')),
  decryptString: vi.fn((encrypted: Buffer) => encrypted.toString('utf8')),
}));

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData, getVersion: () => '0.0.0-test' },
  ipcMain: { on: vi.fn() },
  safeStorage: safeStorageMocks,
}));

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@main/infra/db/connection';
import * as store from '@main/infra/store';
import {
  CURRENT_SCHEMA_VERSION,
  STORE_KEY_AUTH,
  STORE_KEY_INSTANCE_REGISTRY,
  STORE_KEY_LAST_PLAYED,
  STORE_KEY_LAUNCHER_SETTINGS,
  STORE_KEY_SCHEMA_VERSION,
} from '@shared/constants';
import type { LauncherSettings } from '@shared/contracts/settings';

const dbFile = path.join(tmpUserData, 'launcher.db');
const legacyStoreFile = path.join(tmpUserData, 'launcher.json');
const legacyAuthSecretFile = path.join(tmpUserData, 'auth-session.bin');
const mojangClientId = '11111111-2222-3333-4444-555555555555';
const mojangPlayerUuid = '00000000-1111-2222-3333-444444444444';
const mojangXuid = '1234567890';

const yggMetadata = {
  provider: 'yggdrasil' as const,
  profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
};

const YGG_SESSION_TOKEN = 'session-token';
const YGG_SESSION_EXPIRES_AT = Date.UTC(2099, 0, 1);

// Seed the legacy electron-store layout so initStore's one-time import runs.
const writeLegacyStore = (payload: Record<string, unknown>): void => {
  fs.writeFileSync(legacyStoreFile, JSON.stringify(payload), 'utf8');
};

// The legacy secret file holds safeStorage-encrypted bytes. With the identity
// mock above, that is just the JSON payload as UTF-8.
const writeLegacyAuthSecret = (payload: Record<string, unknown>): void => {
  fs.writeFileSync(legacyAuthSecretFile, Buffer.from(JSON.stringify(payload), 'utf8'));
};

const authRow = (): { metadata: string; secret: Buffer | null } | undefined =>
  getDb().prepare('SELECT metadata, secret FROM auth_account WHERE id = 1').get() as
    | { metadata: string; secret: Buffer | null }
    | undefined;

const metaValue = (key: string): string | null =>
  (
    getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
  )?.value ?? null;

const removeFile = (file: string): void => {
  if (fs.existsSync(file)) fs.rmSync(file);
};

beforeEach(() => {
  for (const mock of Object.values(loggerMocks)) mock.mockClear();
  safeStorageMocks.isEncryptionAvailable.mockReset().mockReturnValue(true);
  safeStorageMocks.getSelectedStorageBackend.mockReset().mockReturnValue('gnome_libsecret');
  safeStorageMocks.encryptString
    .mockReset()
    .mockImplementation((plainText: string) => Buffer.from(plainText, 'utf8'));
  safeStorageMocks.decryptString
    .mockReset()
    .mockImplementation((encrypted: Buffer) => encrypted.toString('utf8'));

  store.closeDatabase();
  for (const file of [
    dbFile,
    `${dbFile}-wal`,
    `${dbFile}-shm`,
    legacyStoreFile,
    legacyAuthSecretFile,
  ]) {
    removeFile(file);
  }
  removeFile(`${legacyStoreFile}.imported`);
  removeFile(`${legacyAuthSecretFile}.imported`);
});

afterAll(() => {
  store.closeDatabase();
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

describe('getStoredAuth', () => {
  it('round-trips a persisted session through metadata and the secret blob', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );

    const session = store.getStoredAuth();
    expect(session).toMatchObject({ provider: 'yggdrasil', accessToken: 'access' });
    expect(authRow()?.metadata).not.toContain('accessToken');
    expect(authRow()?.metadata).not.toContain(YGG_SESSION_TOKEN);
    expect(authRow()?.secret).toBeInstanceOf(Buffer);
    // The session token rides inside the encrypted secret and is readable back.
    expect(store.getStoredSessionToken()).toBe(YGG_SESSION_TOKEN);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('round-trips the API bearer expiry alongside the token', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );

    expect(store.getStoredApiSession()).toEqual({
      token: YGG_SESSION_TOKEN,
      expiresAt: YGG_SESSION_EXPIRES_AT,
    });
    // The expiry is not secret, but it lives inside the encrypted blob so one
    // decrypt yields the whole API session.
    expect(authRow()?.metadata).not.toContain(String(YGG_SESSION_EXPIRES_AT));
  });

  it('reads a secret written without an expiry as unknown rather than dropping the session', () => {
    // CON-06 migration path: blobs written before expiry tracking must keep
    // authenticating; a null expiry tells the caller to refresh once.
    store.initStore();
    getDb()
      .prepare('INSERT INTO auth_account (id, metadata, secret) VALUES (1, ?, ?)')
      .run(
        JSON.stringify(yggMetadata),
        Buffer.from(
          JSON.stringify({
            version: 2,
            provider: 'yggdrasil',
            accessToken: 'access',
            clientToken: 'client',
            sessionToken: YGG_SESSION_TOKEN,
          }),
          'utf8',
        ),
      );

    expect(store.getStoredApiSession()).toEqual({ token: YGG_SESSION_TOKEN, expiresAt: null });
    expect(store.getStoredAuth()).toMatchObject({ provider: 'yggdrasil', accessToken: 'access' });
  });

  it('persists a null expiry when the server omitted one', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: null },
    );

    expect(store.getStoredApiSession()).toEqual({ token: YGG_SESSION_TOKEN, expiresAt: null });
  });

  it('drops a legacy version-1 secret (no session token) and forces a fresh sign-in', () => {
    writeLegacyStore({
      [STORE_KEY_AUTH]: yggMetadata,
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    // A pre-unification secret has no `sessionToken`, so it now fails validation
    // and the user must re-authenticate to obtain an API bearer.
    writeLegacyAuthSecret({
      version: 1,
      provider: 'yggdrasil',
      accessToken: 'access',
      clientToken: 'client',
    });
    store.initStore();

    expect(store.getStoredAuth()).toBeNull();
    expect(store.getStoredSessionToken()).toBeNull();
  });

  it('serves repeated bearer reads from memory instead of decrypting per call', () => {
    // The bearer is read once per bundle file request and per media fetch, so a
    // sqlite hit + synchronous DPAPI decrypt per call was thousands of
    // round-trips on a large bundle sync (LM-08).
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    store.getStoredSessionToken();
    safeStorageMocks.decryptString.mockClear();

    for (let i = 0; i < 25; i++) {
      expect(store.getStoredSessionToken()).toBe(YGG_SESSION_TOKEN);
    }

    expect(safeStorageMocks.decryptString).not.toHaveBeenCalled();
  });

  it('serves the rotated bearer on the first read after a refresh persisted it', () => {
    // Rotation is single-use server-side: a stale cached bearer would burn the
    // new token on the next request.
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    expect(store.getStoredSessionToken()).toBe(YGG_SESSION_TOKEN);

    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: 'rotated-session-token', expiresAt: YGG_SESSION_EXPIRES_AT },
    );

    expect(store.getStoredSessionToken()).toBe('rotated-session-token');
    expect(store.getStoredApiSession()).toEqual({
      token: 'rotated-session-token',
      expiresAt: YGG_SESSION_EXPIRES_AT,
    });
  });

  it('stops serving the bearer once the session is cleared', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    expect(store.getStoredSessionToken()).toBe(YGG_SESSION_TOKEN);

    store.clearStoredAuth();

    expect(store.getStoredSessionToken()).toBeNull();
  });

  it('does not cache a decrypt failure so a transient secure-storage outage recovers', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    safeStorageMocks.decryptString.mockImplementationOnce(() => {
      throw new Error('keyring busy');
    });

    expect(store.getStoredSessionToken()).toBeNull();
    expect(store.getStoredSessionToken()).toBe(YGG_SESSION_TOKEN);
  });

  it('migrates a legacy plaintext Yggdrasil session by forcing a fresh sign-in', () => {
    // A legacy plaintext Yggdrasil session predates the session token, so it
    // cannot be migrated in place and is dropped.
    writeLegacyStore({
      [STORE_KEY_AUTH]: { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    store.initStore();

    expect(store.getStoredAuth()).toBeNull();
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('migrates a legacy plaintext Mojang session into the secret blob', () => {
    writeLegacyStore({
      [STORE_KEY_AUTH]: {
        provider: 'mojang',
        accessToken: 'minecraft-access',
        expiresAt: Date.UTC(2099, 0, 1),
        refreshToken: 'microsoft-refresh',
        clientId: mojangClientId,
        xuid: mojangXuid,
        profile: { uuid: mojangPlayerUuid, username: 'someone', skins: [] },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    store.initStore();

    expect(store.getStoredAuth()).toMatchObject({
      provider: 'mojang',
      accessToken: 'minecraft-access',
      refreshToken: 'microsoft-refresh',
    });
    const metadata = authRow()?.metadata ?? '';
    expect(metadata).not.toContain('accessToken');
    expect(metadata).not.toContain('refreshToken');
  });

  it('keeps a legacy plaintext Mojang row when secure storage is transiently unavailable during migration', () => {
    writeLegacyStore({
      [STORE_KEY_AUTH]: {
        provider: 'mojang',
        accessToken: 'minecraft-access',
        expiresAt: Date.UTC(2099, 0, 1),
        refreshToken: 'microsoft-refresh',
        clientId: mojangClientId,
        xuid: mojangXuid,
        profile: { uuid: mojangPlayerUuid, username: 'someone', skins: [] },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    // runAuthStoreMigrationIfNeeded is NOT triggered by initStore directly; the
    // import seeds the row, and the first getStoredAuth attempts migration.
    safeStorageMocks.isEncryptionAvailable.mockReturnValue(false);
    store.initStore();

    expect(store.getStoredAuth()).toBeNull();
    // The legacy plaintext row survives the transient outage for a later retry.
    expect(authRow()).toBeDefined();

    // When secure storage recovers, the legacy row migrates into the secret blob.
    safeStorageMocks.isEncryptionAvailable.mockReturnValue(true);
    expect(store.getStoredAuth()).toMatchObject({
      provider: 'mojang',
      accessToken: 'minecraft-access',
    });
  });

  it('returns null and warns when the persisted metadata is malformed', () => {
    store.initStore();
    getDb()
      .prepare('INSERT INTO auth_account (id, metadata, secret) VALUES (1, ?, ?)')
      .run(JSON.stringify({ provider: 'yggdrasil', accessToken: 1, clientToken: 'c' }), null);

    expect(store.getStoredAuth()).toBeNull();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it('returns null when a persisted Mojang session has malformed metadata', () => {
    store.initStore();
    getDb()
      .prepare('INSERT INTO auth_account (id, metadata, secret) VALUES (1, ?, ?)')
      .run(
        JSON.stringify({
          provider: 'mojang',
          expiresAt: 1_700_000_000,
          clientId: mojangClientId,
          xuid: mojangXuid,
          profile: { uuid: mojangPlayerUuid, username: 'someone', skins: [] },
        }),
        Buffer.from(
          JSON.stringify({ version: 1, provider: 'mojang', accessToken: 'a', refreshToken: 'r' }),
        ),
      );

    expect(store.getStoredAuth()).toBeNull();
    expect(authRow()).toBeUndefined();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it('purges sessions tagged with a legacy/unrecognized provider on first load', () => {
    writeLegacyStore({
      [STORE_KEY_AUTH]: {
        provider: 'legacy',
        jwt: 'a.b.c',
        user: { id: 1, username: 'someone', email: 'someone@example.com', blocked: false },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    store.initStore();

    expect(store.getStoredAuth()).toBeNull();
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('clears the local session when the secret blob is missing', () => {
    store.initStore();
    getDb()
      .prepare('INSERT INTO auth_account (id, metadata, secret) VALUES (1, ?, ?)')
      .run(JSON.stringify(yggMetadata), null);

    expect(store.getStoredAuth()).toBeNull();
    expect(authRow()).toBeUndefined();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Stored auth secret could not be read; forcing a fresh sign-in',
      { message: 'Stored auth secret is missing' },
    );
  });

  it('keeps the stored session when secure storage is transiently unavailable', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    // A keyring/DBus hiccup: decrypt is impossible right now, but the row is
    // still valid and must survive for the next read (transient branch).
    safeStorageMocks.isEncryptionAvailable.mockReturnValue(false);

    expect(store.getStoredAuth()).toBeNull();
    expect(authRow()).toBeDefined();

    // Once secure storage recovers, the same row hydrates the session again.
    safeStorageMocks.isEncryptionAvailable.mockReturnValue(true);
    expect(store.getStoredAuth()).toMatchObject({ provider: 'yggdrasil', accessToken: 'access' });
  });

  it('clears the session when the secret blob is present but undecryptable (corrupt)', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    // Secure storage is available, but the blob no longer decrypts/validates:
    // a genuinely corrupt secret IS destructive (corrupt branch).
    safeStorageMocks.decryptString.mockImplementation(() => {
      throw new Error('bad ciphertext');
    });

    expect(store.getStoredAuth()).toBeNull();
    expect(authRow()).toBeUndefined();
  });
});

describe('clearStoredAuth', () => {
  it('removes the account metadata and secret blob', () => {
    store.initStore();
    store.setStoredAuth(
      { ...yggMetadata, accessToken: 'access', clientToken: 'client' },
      { token: YGG_SESSION_TOKEN, expiresAt: YGG_SESSION_EXPIRES_AT },
    );
    expect(authRow()).toBeDefined();

    store.clearStoredAuth();
    expect(authRow()).toBeUndefined();
  });
});

const settingsFixture = (allocatedRamMb = 0): LauncherSettings => ({
  memory: { allocatedRamMb },
  storage: { clientsFolder: '' },
  launch: { console: false, fullscreen: false },
  clients: {},
});

describe('applySettingsMigrations', () => {
  it('throws on a gap in the migration chain', () => {
    expect(() => store.applySettingsMigrations(settingsFixture(), 0, 1, {})).toThrow(
      'Missing schema migration step from version 0 to 1',
    );
  });

  it('applies steps in order, threading each output into the next', () => {
    const calls: number[] = [];
    const migrations = {
      0: (settings: LauncherSettings): LauncherSettings => {
        calls.push(0);
        return { ...settings, memory: { allocatedRamMb: 10 } };
      },
      1: (settings: LauncherSettings): LauncherSettings => {
        calls.push(1);
        return { ...settings, memory: { allocatedRamMb: settings.memory.allocatedRamMb + 5 } };
      },
    };

    const result = store.applySettingsMigrations(settingsFixture(), 0, 2, migrations);

    expect(calls).toEqual([0, 1]);
    expect(result.memory.allocatedRamMb).toBe(15);
  });

  it('returns the settings unchanged when already at the target version', () => {
    const settings = settingsFixture(4096);
    expect(store.applySettingsMigrations(settings, 1, 1, {})).toBe(settings);
  });

  it('throws at the first missing step in a partial chain', () => {
    const migrations = { 0: (settings: LauncherSettings): LauncherSettings => settings };
    expect(() => store.applySettingsMigrations(settingsFixture(), 0, 2, migrations)).toThrow(
      'Missing schema migration step from version 1 to 2',
    );
  });

  it('supplies a migration step for every version up to CURRENT_SCHEMA_VERSION', () => {
    expect(() =>
      store.applySettingsMigrations(settingsFixture(), 0, CURRENT_SCHEMA_VERSION),
    ).not.toThrow();
  });
});

describe('initStore', () => {
  it('performs no import or migration until called', () => {
    writeLegacyStore({
      [STORE_KEY_LAUNCHER_SETTINGS]: {
        memory: { allocatedRamMb: 4096 },
        storage: { clientsFolder: '/tmp/clients' },
        launch: { console: true, fullscreen: false },
        clients: {},
      },
      [STORE_KEY_SCHEMA_VERSION]: 0,
    });

    expect(fs.existsSync(legacyStoreFile)).toBe(true);
    expect(fs.existsSync(`${legacyStoreFile}.imported`)).toBe(false);

    store.initStore();

    expect(fs.existsSync(`${legacyStoreFile}.imported`)).toBe(true);
    expect(metaValue(STORE_KEY_SCHEMA_VERSION)).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it('migrates a version-0 legacy store to the current version on import', () => {
    writeLegacyStore({
      [STORE_KEY_LAUNCHER_SETTINGS]: {
        memory: { allocatedRamMb: 4096 },
        storage: { clientsFolder: '/tmp/clients' },
        launch: { console: true, fullscreen: false },
        clients: {},
      },
      [STORE_KEY_SCHEMA_VERSION]: 0,
    });
    store.initStore();

    expect(store.getStoredLauncherSettings().memory.allocatedRamMb).toBe(4096);
    expect(metaValue(STORE_KEY_SCHEMA_VERSION)).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it('imports the instance registry and last-played map from the legacy store', () => {
    writeLegacyStore({
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
      [STORE_KEY_INSTANCE_REGISTRY]: {
        schema: 1,
        instances: [
          {
            id: 'aaaaaaaa-1111-2222-3333-444444444444',
            name: 'Build A',
            dir: '/tmp/a',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      [STORE_KEY_LAST_PLAYED]: { 'local:abc': 1700000000000 },
    });
    store.initStore();

    expect(store.getStoredLocalBuildRegistry().instances).toHaveLength(1);
    expect(store.getStoredLocalBuildRegistry().instances[0]?.name).toBe('Build A');
    expect(store.getLastPlayed()).toEqual({ 'local:abc': 1700000000000 });
  });

  it('seeds defaults on a fresh install with no legacy store', () => {
    store.initStore();
    expect(fs.existsSync(legacyStoreFile)).toBe(false);
    expect(metaValue(STORE_KEY_SCHEMA_VERSION)).toBe(String(CURRENT_SCHEMA_VERSION));
    expect(typeof store.getStoredLauncherSettings().memory.allocatedRamMb).toBe('number');
  });

  it('drops a session tagged with a legacy/unrecognized provider once called', () => {
    writeLegacyStore({
      [STORE_KEY_AUTH]: {
        provider: 'legacy',
        jwt: 'a.b.c',
        user: { id: 1, username: 'someone', email: 'someone@example.com', blocked: false },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    store.initStore();
    expect(authRow()).toBeUndefined();
  });
});

describe('getStoredLauncherSettings', () => {
  it('returns defaults and warns when a stored override is structurally invalid', () => {
    store.initStore();
    getDb()
      .prepare('INSERT INTO client_overrides (slug, data) VALUES (?, ?)')
      .run('broken', JSON.stringify({ memory: { allocatedRamMb: 'not-a-number' } }));

    const settings = store.getStoredLauncherSettings();
    expect(typeof settings.memory.allocatedRamMb).toBe('number');
    expect(settings.memory.allocatedRamMb).toBeGreaterThanOrEqual(0);
    expect(settings.clients).toEqual({});
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it('round-trips a valid settings object', () => {
    store.initStore();
    store.setStoredLauncherSettings({
      memory: { allocatedRamMb: 4096 },
      storage: { clientsFolder: '/tmp/clients' },
      launch: { console: true, fullscreen: false },
      clients: {},
    });

    const settings = store.getStoredLauncherSettings();
    expect(settings.memory.allocatedRamMb).toBe(4096);
    expect(settings.storage.clientsFolder).toBe('/tmp/clients');
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('rehydrates a legacy bare-slug client override under official:<slug> on read', () => {
    store.initStore();
    // Simulate a pre-CatalogKey store: an override row keyed by the bare slug.
    getDb()
      .prepare('INSERT INTO client_overrides (slug, data) VALUES (?, ?)')
      .run('survival', JSON.stringify({ memory: { allocatedRamMb: 4096 } }));

    const settings = store.getStoredLauncherSettings();
    expect(settings.clients['official:survival']).toEqual({ memory: { allocatedRamMb: 4096 } });
    expect(settings.clients.survival).toBeUndefined();
  });

  it('rehydrates a legacy bare-uuid client override under local:<uuid> on read', () => {
    store.initStore();
    const uuid = 'aaaaaaaa-1111-2222-3333-444444444444';
    getDb()
      .prepare('INSERT INTO client_overrides (slug, data) VALUES (?, ?)')
      .run(uuid, JSON.stringify({ loader: 'forge' }));

    const settings = store.getStoredLauncherSettings();
    expect(settings.clients[`local:${uuid}`]).toEqual({ loader: 'forge' });
    expect(settings.clients[uuid]).toBeUndefined();
  });
});

describe('getLastPlayed migration', () => {
  it('rehydrates a legacy bare-keyed last-played entry to the CatalogKey form', () => {
    store.initStore();
    getDb()
      .prepare('INSERT INTO last_played (catalog_key, played_at) VALUES (?, ?)')
      .run('survival', 1700000000000);

    expect(store.getLastPlayed()).toEqual({ 'official:survival': 1700000000000 });
  });

  it('passes an already-namespaced last-played key through unchanged', () => {
    store.initStore();
    store.recordPlayed('local:abc');
    expect(store.getLastPlayed()).toEqual({ 'local:abc': expect.any(Number) });
  });
});
