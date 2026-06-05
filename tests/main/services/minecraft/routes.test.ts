import { MinecraftKitError } from '@loontail/minecraft-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({ app: appMock }));

import type { Router } from '@main/ipc/router';
import { ManagerError } from '@main/services/minecraft/errors';
import type { MinecraftManager } from '@main/services/minecraft/manager';
import { registerMinecraftRoutes } from '@main/services/minecraft/routes';
import { ERROR_CODES } from '@shared/constants';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { IPC_CHANNELS, type IpcArgs, type IpcContract, type IpcResult } from '@shared/ipc';
import type { IpcMainInvokeEvent } from 'electron';

beforeEach(() => {
  appMock.isPackaged = false;
});

afterEach(() => {
  appMock.isPackaged = false;
});

type StoredHandler = (rawArgs: unknown) => Promise<unknown> | unknown;

const fakeEvent = (): IpcMainInvokeEvent => ({}) as unknown as IpcMainInvokeEvent;

const createTestRouter = (): { router: Router; handlers: Map<string, StoredHandler> } => {
  const handlers = new Map<string, StoredHandler>();
  const router: Router = {
    handle<TChannel extends keyof IpcContract>(
      channel: TChannel,
      handler: (
        args: IpcArgs<TChannel>,
        event: IpcMainInvokeEvent,
      ) => Promise<IpcResult<TChannel>> | IpcResult<TChannel>,
    ): void {
      handlers.set(channel, (rawArgs) => handler(rawArgs as IpcArgs<TChannel>, fakeEvent()));
    },
    dispose: () => undefined,
  };
  return { router, handlers };
};

const handlerFor = (channel: string, fail: (slug: string) => Promise<void>): StoredHandler => {
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
  [IPC_CHANNELS.minecraftInstall, { slug: 'vanilla' }],
  [IPC_CHANNELS.minecraftRepair, 'vanilla'],
  [IPC_CHANNELS.minecraftLaunch, 'vanilla'],
];

describe('registerMinecraftRoutes error reclassification', () => {
  for (const [channel, payload] of ENTRY_POINTS) {
    it(`reclassifies a raw kit error from ${channel} into a coded ManagerError`, async () => {
      const handler = handlerFor(channel, () =>
        Promise.reject(new MinecraftKitError('NETWORK_TIMEOUT', 'boom')),
      );
      await expect(handler(payload)).rejects.toMatchObject({
        name: 'ManagerError',
        code: MinecraftErrorCodes.NETWORK_ERROR,
      });
    });
  }

  it('passes an already-coded ManagerError through unchanged', async () => {
    const original = new ManagerError(MinecraftErrorCodes.NO_ACCOUNT, 'no account');
    const handler = handlerFor(IPC_CHANNELS.minecraftRepair, () => Promise.reject(original));
    await expect(handler('vanilla')).rejects.toBe(original);
  });

  it('leaves a non-kit error untouched so the IPC boundary handles it', async () => {
    const original = new Error('generic boom');
    const handler = handlerFor(IPC_CHANNELS.minecraftLaunch, () => Promise.reject(original));
    await expect(handler('vanilla')).rejects.toBe(original);
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

// Several routes (pause/resume/cancel/stop) register synchronous handlers, so a
// failed parseIpcArgs throws synchronously rather than producing a rejected
// promise. The real router wraps every handler in an async fn that normalises
// this; the fake test router does not, so capture both throw shapes here.
const captureThrow = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the handler to throw');
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

  for (const [channel, method] of SLUG_ONLY) {
    it(`${channel} forwards a valid slug to manager.${String(method)}`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      await handlers.get(channel)?.('vanilla');
      expect(manager[method]).toHaveBeenCalledWith('vanilla');
    });

    it(`${channel} rejects a non-string slug with IPC_INVALID_ARGS and skips the manager`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.(42));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects an empty-string slug`, async () => {
      const manager = fullManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.(''));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
      expect(manager[method]).not.toHaveBeenCalled();
    });
  }

  it('minecraft.install forwards the parsed slug and loader', async () => {
    const manager = fullManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.minecraftInstall)?.({ slug: 'vanilla', loader: 'fabric' });
    expect(manager.startInstall).toHaveBeenCalledWith('vanilla', 'fabric');
  });

  it('minecraft.install rejects a missing slug without calling the manager', async () => {
    const manager = fullManager();
    const handlers = registerWith(manager);
    await expect(
      handlers.get(IPC_CHANNELS.minecraftInstall)?.({ loader: 'fabric' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.IpcInvalidArgs,
    });
    expect(manager.startInstall).not.toHaveBeenCalled();
  });
});
