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

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData, getVersion: () => '0.0.0-test' },
  ipcMain: { on: vi.fn() },
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

const storeFile = path.join(tmpUserData, 'launcher.json');

const writeStore = (payload: Record<string, unknown>): void => {
  fs.writeFileSync(storeFile, JSON.stringify(payload), 'utf8');
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
  if (fs.existsSync(storeFile)) fs.rmSync(storeFile);
});

afterAll(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

describe('getStoredAuth', () => {
  it('returns the persisted session when the shape is valid', async () => {
    writeStore({
      [STORE_KEY_AUTH]: {
        provider: 'strapi',
        jwt: 'a.b.c',
        user: {
          id: 1,
          username: 'someone',
          email: 'someone@example.com',
          blocked: false,
        },
      },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredAuth } = await loadStoreModule();
    const session = getStoredAuth();
    expect(session).toMatchObject({ provider: 'strapi', jwt: 'a.b.c' });
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns when the persisted blob is malformed', async () => {
    writeStore({
      [STORE_KEY_AUTH]: { provider: 'strapi', jwt: 123, user: 'not-an-object' },
      [STORE_KEY_SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    });

    const { getStoredAuth } = await loadStoreModule();
    expect(getStoredAuth()).toBeNull();
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
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
