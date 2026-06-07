import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Registrars transitively import @main/config, which reads required env vars at
// module-eval time. Seed them before any import resolves (mirrors auth.test.ts).
vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  process.env.MOJANG_CLIENT_ID ??= '00000000-0000-0000-0000-000000000000';
});

const appMock = vi.hoisted(() => ({
  isPackaged: false,
  getVersion: () => '0.0.0-test',
  getPath: () => '/tmp',
}));

vi.mock('electron', () => ({
  app: appMock,
  clipboard: { writeText: vi.fn() },
  autoUpdater: {
    setFeedURL: vi.fn(),
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@main/infra/logger', () => ({ scopedLogger: () => loggerMock }));

import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { ConsoleHub } from '@main/infra/consoleHub';
import type { Router } from '@main/ipc/router';
import { registerAppRoutes } from '@main/services/app/routes';
import type { MojangAuth } from '@main/services/auth/mojangAuth';
import { registerAuthRoutes } from '@main/services/auth/routes';
import type { YggdrasilAuth } from '@main/services/auth/yggdrasilAuth';
import type { FetchTextures } from '@main/services/auth/yggdrasilClient';
import type { BundleManager } from '@main/services/bundle/manager';
import { registerBundleRoutes } from '@main/services/bundle/routes';
import type { CatalogService } from '@main/services/catalog/catalog';
import { registerCatalogRoutes } from '@main/services/catalog/routes';
import { registerClientsRoutes } from '@main/services/clients/routes';
import { createConsoleService } from '@main/services/console';
import { registerInstanceRoutes } from '@main/services/instances/routes';
import { registerMediaRoutes } from '@main/services/media/routes';
import type { MinecraftManager } from '@main/services/minecraft/manager';
import { registerMinecraftRoutes } from '@main/services/minecraft/routes';
import { registerServersRoutes } from '@main/services/servers/routes';
import { registerSettingsRoutes } from '@main/services/settings/routes';
import { registerSkinRoutes } from '@main/services/skin/routes';
import type { SkinHandlers } from '@main/services/skin/skin';
import { registerSystemRoutes } from '@main/services/system/routes';
import { createUpdaterService } from '@main/services/updater';
import { IPC_CHANNELS, type IpcContract } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

const recordingRouter = (): { router: Router; registered: Set<string> } => {
  const registered = new Set<string>();
  const router: Router = {
    handle: (channel) => {
      registered.add(channel);
    },
    dispose: () => undefined,
  };
  return { router, registered };
};

const stub = <T>(): T => ({}) as T;
const fakeWindow = () => ({ isDestroyed: () => false }) as unknown as BrowserWindow;
const fakeConsoleHub = () => stub<ConsoleHub>();

beforeEach(() => {
  appMock.isPackaged = false;
});

afterEach(() => {
  vi.clearAllMocks();
  appMock.isPackaged = false;
});

describe('IpcContract handler coverage', () => {
  it('registers a handler for every IpcContract channel exactly once', async () => {
    const { router, registered } = recordingRouter();

    registerAppRoutes(router);
    registerAuthRoutes(router, stub<YggdrasilAuth>(), stub<MojangAuth>(), stub<FetchTextures>());
    registerSettingsRoutes(router, fakeWindow());
    registerSystemRoutes(router, fakeWindow());
    registerMediaRoutes(router);
    registerSkinRoutes(router, stub<SkinHandlers>());
    registerClientsRoutes(router);
    registerCatalogRoutes(router, stub<CatalogService>());
    registerInstanceRoutes(router, stub<MinecraftKit>());
    registerServersRoutes(router);
    registerMinecraftRoutes(router, stub<MinecraftManager>());
    registerBundleRoutes(router, stub<BundleManager>());
    await createConsoleService(router, fakeConsoleHub()).init();
    await createUpdaterService(router, fakeWindow()).init();

    const contractChannels = Object.values(IPC_CHANNELS) as Array<keyof IpcContract>;

    const missing = contractChannels.filter((channel) => !registered.has(channel));
    expect(missing).toEqual([]);

    // No stray registrations outside the contract (e.g. a renamed channel still
    // wired under an old name).
    const extra = [...registered].filter(
      (channel) => !contractChannels.includes(channel as keyof IpcContract),
    );
    expect(extra).toEqual([]);

    expect(registered.size).toBe(contractChannels.length);
  });
});
