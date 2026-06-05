import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({ app: appMock }));

import type { Router } from '@main/ipc/router';
import type { BundleManager } from '@main/services/bundle/manager';
import { registerBundleRoutes } from '@main/services/bundle/routes';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS, type IpcArgs, type IpcContract, type IpcResult } from '@shared/ipc';
import type { IpcMainInvokeEvent } from 'electron';

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

const fakeManager = () =>
  ({
    startSync: vi.fn(async () => undefined),
    pauseSync: vi.fn(),
    resumeSync: vi.fn(async () => undefined),
    cancelSync: vi.fn(),
    getInstallState: vi.fn(async () => ({
      installed: true,
      signatureMatches: true,
      progress: null,
    })),
  }) as unknown as BundleManager & Record<string, ReturnType<typeof vi.fn>>;

const registerWith = (manager: BundleManager) => {
  const { router, handlers } = createTestRouter();
  registerBundleRoutes(router, manager);
  return handlers;
};

// bundle.pause / bundle.cancel register synchronous handlers, so a failed
// parseIpcArgs throws synchronously instead of rejecting a promise. The fake
// test router does not wrap handlers the way the real router does, so capture
// both throw shapes.
const captureThrow = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the handler to throw');
};

beforeEach(() => {
  appMock.isPackaged = false;
});

afterEach(() => {
  appMock.isPackaged = false;
});

describe('registerBundleRoutes', () => {
  const SLUG_ONLY: Array<[string, keyof BundleManager]> = [
    [IPC_CHANNELS.bundlePause, 'pauseSync'],
    [IPC_CHANNELS.bundleResume, 'resumeSync'],
    [IPC_CHANNELS.bundleCancel, 'cancelSync'],
    [IPC_CHANNELS.bundleCheckStatus, 'getInstallState'],
  ];

  for (const [channel, method] of SLUG_ONLY) {
    it(`${channel} forwards a valid slug to manager.${String(method)}`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      await handlers.get(channel)?.('vanilla');
      expect(manager[method]).toHaveBeenCalledWith('vanilla');
    });

    it(`${channel} rejects a non-string slug with IPC_INVALID_ARGS and skips the manager`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.({ slug: 'vanilla' }));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects an empty-string slug`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.(''));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
      expect(manager[method]).not.toHaveBeenCalled();
    });
  }

  it('bundle.checkStatus returns the manager install state', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await expect(handlers.get(IPC_CHANNELS.bundleCheckStatus)?.('vanilla')).resolves.toEqual({
      installed: true,
      signatureMatches: true,
      progress: null,
    });
  });

  it('bundle.start forwards a parsed request with the optional force flag', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'vanilla', force: true });
    expect(manager.startSync).toHaveBeenCalledWith({ slug: 'vanilla', force: true });
  });

  it('bundle.start accepts a request without force', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'vanilla' });
    expect(manager.startSync).toHaveBeenCalledWith({ slug: 'vanilla' });
  });

  it('bundle.start rejects a missing slug without calling the manager', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.bundleStart)?.({ force: true }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(manager.startSync).not.toHaveBeenCalled();
  });

  it('bundle.start rejects a non-boolean force flag', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'vanilla', force: 'yes' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(manager.startSync).not.toHaveBeenCalled();
  });
});
