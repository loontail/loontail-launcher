import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpUserData = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
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

// vitest does not propagate the `electron` mock above into electron-store's
// CommonJS `require('electron')`, so electron-store falls back to envPaths
// and writes outside our tmp. Mock electron-store with a thin file-backed
// stand-in that reads/writes <tmpUserData>/launcher.json synchronously.
vi.mock('electron-store', () => {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } =
    require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  type StoreOptions<S> = { name?: string; defaults?: S };

  class FakeStore<S extends Record<string, unknown>> {
    private file: string;
    private cache: S;
    constructor(options: StoreOptions<S>) {
      mkdirSync(tmpUserData, { recursive: true });
      this.file = join(tmpUserData, `${options.name ?? 'config'}.json`);
      const defaults = options.defaults ?? ({} as S);
      const onDisk = existsSync(this.file)
        ? (JSON.parse(readFileSync(this.file, 'utf8')) as S)
        : ({} as S);
      this.cache = { ...defaults, ...onDisk };
    }
    get<K extends keyof S>(key: K): S[K] {
      return this.cache[key];
    }
    set<K extends keyof S>(key: K, value: S[K]): void {
      this.cache[key] = value;
      writeFileSync(this.file, JSON.stringify(this.cache), 'utf8');
    }
  }

  return { default: FakeStore };
});

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => loggerMocks,
}));

import fs from 'node:fs';
import path from 'node:path';
import {
  CURRENT_SCHEMA_VERSION,
  STORE_KEY_AUTH,
  STORE_KEY_LAUNCHER_SETTINGS,
  STORE_KEY_SCHEMA_VERSION,
} from '@shared/constants';
import type { AuthSession } from '@shared/contracts/auth';

const storeFile = path.join(tmpUserData, 'launcher.json');
const authSecretFile = path.join(tmpUserData, 'auth-session.bin');
const mojangClientId = '11111111-2222-3333-4444-555555555555';
const mojangPlayerUuid = '00000000-1111-2222-3333-444444444444';
const mojangXuid = '1234567890';

const writeStore = (payload: Record<string, unknown>): void => {
  fs.writeFileSync(storeFile, JSON.stringify(payload), 'utf8');
};

const writeAuthSecret = (payload: Record<string, unknown>): void => {
  fs.writeFileSync(authSecretFile, JSON.stringify(payload), 'utf8');
};

const loadStoreModule = async (): Promise<typeof import('@main/infra/store')> => {
  vi.resetModules();
  return import('@main/infra/store');
};

beforeEach(() => {
  loggerMocks.warn.mockClear();
  loggerMocks.info.mockClear();
  loggerMocks.error.mockClear();
  loggerMocks.debug.mockClear();
  safeStorageMocks.isEncryptionAvailable.mockReset();
  safeStorageMocks.getSelectedStorageBackend.mockReset();
  safeStorageMocks.encryptString.mockReset();
  safeStorageMocks.decryptString.mockReset();
  safeStorageMocks.isEncryptionAvailable.mockReturnValue(true);
  safeStorageMocks.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
  safeStorageMocks.encryptString.mockImplementation((plainText: string) =>
    Buffer.from(plainText, 'utf8'),
  );
  safeStorageMocks.decryptString.mockImplementation((encrypted: Buffer) =>
    encrypted.toString('utf8'),
  );
  if (fs.existsSync(storeFile)) fs.rmSync(storeFile);
  if (fs.existsSync(authSecretFile)) fs.rmSync(authSecretFile);
});

afterAll(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

describe('getStoredAuth', () => {
  it('returns the persisted session from account metadata and secure storage', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'yggdrasil',
        profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    writeAuthSecret({
      version: 1,
      provider: 'yggdrasil',
      accessToken: 'access',
      clientToken: 'client',
    });

    const { getStoredAuth } = await loadStoreModule();
    const session = getStoredAuth();
    expect(session).toMatchObject({ provider: 'yggdrasil', accessToken: 'access' });
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('migrates a legacy plaintext session into metadata plus secure storage', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'yggdrasil',
        accessToken: 'access',
        clientToken: 'client',
        profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredAuth } = await loadStoreModule();
    const session = getStoredAuth();
    expect(session).toMatchObject({ provider: 'yggdrasil', accessToken: 'access' });
    expect(fs.existsSync(authSecretFile)).toBe(true);
    const launcherJson = fs.readFileSync(storeFile, 'utf8');
    expect(launcherJson).not.toContain('accessToken');
    expect(launcherJson).not.toContain('clientToken');
    expect(launcherJson).not.toContain('refreshToken');
    expect(loggerMocks.info).toHaveBeenCalledWith(
      'Migrated auth session secrets to secure storage',
    );
  });

  it('migrates a legacy plaintext Mojang session into secure storage', async () => {
    writeStore({
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

    const { getStoredAuth } = await loadStoreModule();
    const session = getStoredAuth();
    expect(session).toMatchObject({
      provider: 'mojang',
      accessToken: 'minecraft-access',
      refreshToken: 'microsoft-refresh',
    });
    expect(fs.existsSync(authSecretFile)).toBe(true);
    const launcherJson = fs.readFileSync(storeFile, 'utf8');
    expect(launcherJson).not.toContain('accessToken');
    expect(launcherJson).not.toContain('clientToken');
    expect(launcherJson).not.toContain('refreshToken');
  });

  it('returns null and warns when the persisted blob is malformed', async () => {
    writeStore({
      [STORE_KEY_AUTH]: { provider: 'yggdrasil', accessToken: 1, clientToken: 'c' },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredAuth } = await loadStoreModule();
    expect(getStoredAuth()).toBeNull();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it('returns null when a persisted Mojang session has malformed metadata', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'mojang',
        expiresAt: 1_700_000_000,
        clientId: mojangClientId,
        xuid: mojangXuid,
        profile: { uuid: mojangPlayerUuid, username: 'someone', skins: [] },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    writeAuthSecret({
      version: 1,
      provider: 'mojang',
      accessToken: 'minecraft-access',
      refreshToken: 'microsoft-refresh',
    });

    const { getStoredAuth } = await loadStoreModule();
    expect(getStoredAuth()).toBeNull();
    expect(JSON.parse(fs.readFileSync(storeFile, 'utf8'))).toMatchObject({
      [STORE_KEY_AUTH]: null,
    });
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it('purges legacy strapi-tagged sessions on first load', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'strapi',
        jwt: 'a.b.c',
        user: { id: 1, username: 'someone', email: 'someone@example.com', blocked: false },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredAuth } = await loadStoreModule();
    expect(getStoredAuth()).toBeNull();
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('clears the local session when secure storage is missing', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'yggdrasil',
        profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredAuth } = await loadStoreModule();
    expect(getStoredAuth()).toBeNull();
    expect(JSON.parse(fs.readFileSync(storeFile, 'utf8'))).toMatchObject({
      [STORE_KEY_AUTH]: null,
    });
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Stored auth secret could not be read; forcing a fresh sign-in',
      { message: 'Stored auth secret is missing' },
    );
  });

  it('clears the local session when secure storage is unavailable', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'yggdrasil',
        profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });
    writeAuthSecret({
      version: 1,
      provider: 'yggdrasil',
      accessToken: 'access',
      clientToken: 'client',
    });
    safeStorageMocks.isEncryptionAvailable.mockReturnValue(false);

    const { getStoredAuth } = await loadStoreModule();
    expect(getStoredAuth()).toBeNull();
    expect(JSON.parse(fs.readFileSync(storeFile, 'utf8'))).toMatchObject({
      [STORE_KEY_AUTH]: null,
    });
  });
});

describe('clearStoredAuth', () => {
  it('removes account metadata and secure storage entries', async () => {
    const session = {
      provider: 'yggdrasil',
      accessToken: 'access',
      clientToken: 'client',
      profile: { uuid: '0123456789abcdef0123456789abcdef', name: 'someone' },
    } satisfies AuthSession;

    const { clearStoredAuth, setStoredAuth } = await loadStoreModule();
    setStoredAuth(session);
    expect(fs.existsSync(authSecretFile)).toBe(true);

    clearStoredAuth();
    expect(fs.existsSync(authSecretFile)).toBe(false);
    expect(JSON.parse(fs.readFileSync(storeFile, 'utf8'))).toMatchObject({
      [STORE_KEY_AUTH]: null,
    });
  });
});

describe('getStoredLauncherSettings', () => {
  it('returns defaults and warns when the persisted blob is malformed', async () => {
    writeStore({
      [STORE_KEY_LAUNCHER_SETTINGS]: { memory: 'not-an-object', storage: null, launch: 42 },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredLauncherSettings } = await loadStoreModule();
    const settings = getStoredLauncherSettings();
    expect(typeof settings.memory.allocatedRamMb).toBe('number');
    expect(settings.memory.allocatedRamMb).toBeGreaterThanOrEqual(0);
    expect(settings.storage.clientsFolder).toBe('');
    expect(settings.launch).toEqual({ console: false, fullscreen: false });
    expect(settings.clients).toEqual({});
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it('passes through a valid blob without warning', async () => {
    writeStore({
      [STORE_KEY_LAUNCHER_SETTINGS]: {
        memory: { allocatedRamMb: 4096 },
        storage: { clientsFolder: '/tmp/clients' },
        launch: { console: true, fullscreen: false },
        clients: {},
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredLauncherSettings } = await loadStoreModule();
    const settings = getStoredLauncherSettings();
    expect(settings.memory.allocatedRamMb).toBe(4096);
    expect(settings.storage.clientsFolder).toBe('/tmp/clients');
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });
});
