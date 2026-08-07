import { MinecraftKitError } from '@loontail/minecraft-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({ app: appMock }));

import { MinecraftError } from '@main/services/minecraft/errors';
import type { MinecraftManager } from '@main/services/minecraft/manager';
import { registerMinecraftRoutes } from '@main/services/minecraft/routes';
import { ERROR_CODES } from '@shared/constants';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { IPC_CHANNELS } from '@shared/ipc';
import { captureThrow, createTestRouter, type StoredHandler } from '../../../helpers/router';

beforeEach(() => {
  appMock.isPackaged = false;
});

afterEach(() => {
  appMock.isPackaged = false;
});

const handlerFor = (channel: string, fail: (key: string) => Promise<void>): StoredHandler => {
  const manager = {
    startInstall: vi.fn(fail),
    startRepair: vi.fn(fail),
    startLaunch: vi.fn(fail),
  } as unknown as MinecraftManager;
  const { router, handlers } = createTestRouter();
  registerMinecraftRoutes(router, manager);
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`${channel} handler was not registered`);
  return handler;
};

const ENTRY_POINTS: Array<[string, unknown]> = [
  [IPC_CHANNELS.minecraftInstall, { key: 'official:vanilla' }],
  [IPC_CHANNELS.minecraftRepair, 'official:vanilla'],
  [IPC_CHANNELS.minecraftLaunch, 'official:vanilla'],
];

describe('registerMinecraftRoutes error reclassification', () => {
  for (const [channel, payload] of ENTRY_POINTS) {
    it(`reclassifies a raw kit error from ${channel} into a coded MinecraftError`, async () => {
      const handler = handlerFor(channel, () =>
        Promise.reject(new MinecraftKitError('NETWORK_TIMEOUT', 'boom')),
      );
      await expect(handler(payload)).rejects.toMatchObject({
        name: 'MinecraftError',
        code: MinecraftErrorCodes.NETWORK_ERROR,
      });
    });
  }

  it('passes an already-coded MinecraftError through unchanged', async () => {
    const original = new MinecraftError(MinecraftErrorCodes.NO_ACCOUNT, 'no account');
    const handler = handlerFor(IPC_CHANNELS.minecraftRepair, () => Promise.reject(original));
    await expect(handler('official:vanilla')).rejects.toBe(original);
  });

  it('leaves a non-kit error untouched so the IPC boundary handles it', async () => {
    const original = new Error('generic boom');
    const handler = handlerFor(IPC_CHANNELS.minecraftLaunch, () => Promise.reject(original));
    await expect(handler('official:vanilla')).rejects.toBe(original);
  });
});

const fullManager = () =>
  ({
    getStatus: vi.fn(() => ({ status: 'not-installed', paused: false })),
    startInstall: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    startRepair: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    startLaunch: vi.fn(async () => undefined),
    stop: vi.fn(),
  }) as unknown as MinecraftManager & Record<string, ReturnType<typeof vi.fn>>;

const registerWith = (manager: MinecraftManager) => {
  const { router, handlers } = createTestRouter();
  registerMinecraftRoutes(router, manager);
  return handlers;
};

describe('registerMinecraftRoutes arg routing', () => {
  const SLUG_ONLY: Array<[string, keyof MinecraftManager]> = [
    [IPC_CHANNELS.minecraftGetStatus, 'getStatus'],
    [IPC_CHANNELS.minecraftPause, 'pause'],
    [IPC_CHANNELS.minecraftResume, 'resume'],
    [IPC_CHANNELS.minecraftCancel, 'cancel'],
    [IPC_CHANNELS.minecraftRepair, 'startRepair'],
    [IPC_CHANNELS.minecraftUninstall, 'uninstall'],
    [IPC_CHANNELS.minecraftLaunch, 'startLaunch'],
    [IPC_CHANNELS.minecraftStop, 'stop'],
  ];

  const LOCAL_KEY = 'local:550e8400-e29b-41d4-a716-446655440000';

  for (const [channel, method] of SLUG_ONLY) {
    it(`${channel} forwards a valid CatalogKey to manager.${String(method)}`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      await handlers.get(channel)?.('official:vanilla');
      expect(manager[method]).toHaveBeenCalledWith('official:vanilla');
    });

    it(`${channel} forwards a local CatalogKey unchanged`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      await handlers.get(channel)?.(LOCAL_KEY);
      expect(manager[method]).toHaveBeenCalledWith(LOCAL_KEY);
    });

    it(`${channel} rejects a non-string key with IPC_INVALID_ARGS and skips the manager`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.(42));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects a bare (non-namespaced) id`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.('vanilla'));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects an empty-string key`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.(''));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
      expect(manager[method]).not.toHaveBeenCalled();
    });
  }

  it('minecraft.install forwards the parsed CatalogKey and loader', async () => {
    const manager = fullManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.minecraftInstall)?.({
      key: 'official:vanilla',
      loader: 'fabric',
    });
    expect(manager.startInstall).toHaveBeenCalledWith('official:vanilla', 'fabric');
  });

  it('minecraft.install rejects a bare key without calling the manager', async () => {
    const manager = fullManager();
    const handlers = registerWith(manager);
    await expect(
      handlers.get(IPC_CHANNELS.minecraftInstall)?.({ key: 'vanilla', loader: 'fabric' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.IPC_INVALID_ARGS,
    });
    expect(manager.startInstall).not.toHaveBeenCalled();
  });

  it('minecraft.install rejects a missing key without calling the manager', async () => {
    const manager = fullManager();
    const handlers = registerWith(manager);
    await expect(
      handlers.get(IPC_CHANNELS.minecraftInstall)?.({ loader: 'fabric' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.IPC_INVALID_ARGS,
    });
    expect(manager.startInstall).not.toHaveBeenCalled();
  });
});
