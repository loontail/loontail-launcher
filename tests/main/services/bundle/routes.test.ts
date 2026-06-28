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
    it(`${channel} forwards a valid CatalogKey to manager.${String(method)}`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      await handlers.get(channel)?.('official:vanilla');
      expect(manager[method]).toHaveBeenCalledWith('official:vanilla');
    });

    it(`${channel} rejects a non-string key with IPC_INVALID_ARGS and skips the manager`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() =>
        handlers.get(channel)?.({ slug: 'official:vanilla' }),
      );
      expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects a bare (non-namespaced) id`, async () => {
      const manager = fakeManager();
      const handlers = registerWith(manager);
      const thrown = await captureThrow(() => handlers.get(channel)?.('vanilla'));
      expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
      expect(manager[method]).not.toHaveBeenCalled();
    });

    it(`${channel} rejects an empty-string key`, async () => {
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
    await expect(
      handlers.get(IPC_CHANNELS.bundleCheckStatus)?.('official:vanilla'),
    ).resolves.toEqual({
      installed: true,
      signatureMatches: true,
      progress: null,
    });
  });

  it('bundle.start forwards a parsed request with the optional force flag', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'official:vanilla', force: true });
    expect(manager.startSync).toHaveBeenCalledWith({ slug: 'official:vanilla', force: true });
  });

  it('bundle.start accepts a request without force', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    await handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'official:vanilla' });
    expect(manager.startSync).toHaveBeenCalledWith({ slug: 'official:vanilla' });
  });

  it('bundle.start rejects a bare slug without calling the manager', async () => {
    const manager = fakeManager();
    const handlers = registerWith(manager);
    const thrown = await captureThrow(() =>
      handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'vanilla' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(manager.startSync).not.toHaveBeenCalled();
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
      handlers.get(IPC_CHANNELS.bundleStart)?.({ slug: 'official:vanilla', force: 'yes' }),
    );
    expect(thrown).toMatchObject({ code: ERROR_CODES.IpcInvalidArgs });
    expect(manager.startSync).not.toHaveBeenCalled();
  });
});
