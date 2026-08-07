import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({ app: appMock }));

import type { BundleManager } from '@main/services/bundle/manager';
import { registerBundleRoutes } from '@main/services/bundle/routes';
import { ERROR_CODES } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/ipc';
import { captureThrow, createTestRouter } from '../../../helpers/router';

const fakeManager = () =>
  ({
    start: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(async () => undefined),
    cancel: vi.fn(),
    getStatus: vi.fn(async () => ({
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

beforeEach(() => {
  appMock.isPackaged = false;
});

afterEach(() => {
  appMock.isPackaged = false;
});

describe('registerBundleRoutes', () => {
  const SLUG_ONLY: Array<[string, keyof BundleManager]> = [
    [IPC_CHANNELS.bundlePause, 'pause'],
    [IPC_CHANNELS.bundleResume, 'resume'],
    [IPC_CHANNELS.bundleCancel, 'cancel'],
    [IPC_CHANNELS.bundleGetStatus, 'getStatus'],
  ];

  for (const [channel, method] of SLUG_ONLY) {
    it(`${channel} forwards a valid CatalogKey to manager.${String(method)}`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      await handlers.get(channel)?.('official:vanilla');
      expect(manager[method]).toHaveBeenCalledWith('official:vanilla');
    });

    it(`${channel} rejects a non-string key with IPC_INVALID_ARGS and skips the manager`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.({ key: 'official:vanilla' }));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects a bare (non-namespaced) id`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.('vanilla'));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects an empty-string key`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.(''));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
      expect(manager[method]).not.toHaveBeenCalled();
    });
  }

  it('bundle.getStatus returns the manager install state', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await expect(handlers.get(IPC_CHANNELS.bundleGetStatus)?.('official:vanilla')).resolves.toEqual(
      {
        installed: true,
        signatureMatches: true,
        progress: null,
      },
    );
  });

  it('bundle.start forwards a parsed request with the optional force flag', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.bundleStart)?.({ key: 'official:vanilla', force: true });
    expect(manager.start).toHaveBeenCalledWith({ key: 'official:vanilla', force: true });
  });

  it('bundle.start accepts a request without force', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.bundleStart)?.({ key: 'official:vanilla' });
    expect(manager.start).toHaveBeenCalledWith({ key: 'official:vanilla' });
  });

  it('bundle.start rejects a bare key without calling the manager', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.bundleStart)?.({ key: 'vanilla' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
    expect(manager.start).not.toHaveBeenCalled();
  });

  it('bundle.start rejects a missing key without calling the manager', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.bundleStart)?.({ force: true }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
    expect(manager.start).not.toHaveBeenCalled();
  });

  it('bundle.start rejects a non-boolean force flag', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.bundleStart)?.({ key: 'official:vanilla', force: 'yes' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IPC_INVALID_ARGS });
    expect(manager.start).not.toHaveBeenCalled();
  });
});
