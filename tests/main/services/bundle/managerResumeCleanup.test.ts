import { beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  return {
    getSettings: vi.fn(),
    getClient: vi.fn(),
    resetTaskForResume: vi.fn(),
    downloadEntry: vi.fn(),
    fetchRemoteManifest: vi.fn(),
    buildPlan: vi.fn(),
    loadLocalManifest: vi.fn(),
    saveLocalManifest: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

import { BUNDLE_PAUSED_SYNC_MAX_IDLE_MS } from '@main/constants/bundle';
import { markCancelled, markPaused, markRunning } from '@main/infra/lifecyclePhase';
import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import { BundleError } from '@main/services/bundle/errors';
import { BundleManager } from '@main/services/bundle/manager';
import { runSyncPhases } from '@main/services/bundle/runner';
import { createSyncTask, type SyncStateMap } from '@main/services/bundle/syncState';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import { BundleErrorCodes, BundleSyncStatuses } from '@shared/contracts/bundle';
import { asCatalogKey, type BundleSlug } from '@shared/contracts/ids';
import { seedActiveSync } from '../../../helpers/bundleSync';
import { makeBroadcaster, makeHealer, makeLauncherSettings } from '../../../helpers/fixtures';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => managerMocks.logger,
}));

vi.mock('@main/services/bundle/download', () => ({
  downloadEntry: managerMocks.downloadEntry,
}));

vi.mock('@main/services/clients', () => ({ getClient: managerMocks.getClient }));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: managerMocks.getSettings,
}));

vi.mock('@main/services/bundle/api', () => ({
  fetchRemoteManifest: managerMocks.fetchRemoteManifest,
}));

vi.mock('@main/services/bundle/plan', () => ({
  buildPlan: managerMocks.buildPlan,
}));

vi.mock('@main/services/bundle/manifestRepo', () => ({
  clearLocalManifest: vi.fn(),
  loadLocalManifest: managerMocks.loadLocalManifest,
  saveLocalManifest: managerMocks.saveLocalManifest,
}));

vi.mock('@main/services/bundle/syncState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/bundle/syncState')>();
  return { ...actual, resetTaskForResume: managerMocks.resetTaskForResume };
});

const KEY = asCatalogKey('official:test-client');
const BUNDLE_SLUG = 'bundle-x';
const CLIENT_FOLDER = '/tmp/client';

const launcherSettings = () =>
  makeLauncherSettings({ clients: { [KEY]: { storage: { clientFolder: CLIENT_FOLDER } } } });

const seedPausedActiveWithLock = (
  activeSyncs: SyncStateMap,
  operationLocks: ClientOperationLocks,
): void => {
  const acquired = operationLocks.acquire({
    key: KEY,
    domain: ClientOperationDomains.BUNDLE,
    resources: [ClientOperationResources.CLIENT_FOLDER],
  });
  if (acquired.kind !== 'acquired') throw new Error('Expected bundle lock');

  seedActiveSync(activeSyncs, {
    key: KEY,
    clientFolder: CLIENT_FOLDER,
    bundleSlug: BUNDLE_SLUG as BundleSlug,
    forLaunch: false,
    paused: true,
    lock: acquired.lease,
  });
};

const DOWNLOAD_ENTRY = {
  path: 'mods/example.jar',
  name: 'example.jar',
  size: 1024,
  isDir: false,
  sha256: 'example-sha256',
  url: 'https://cdn.test.invalid/mods/example.jar',
};

const DOWNLOAD_PLAN = {
  toDownload: [DOWNLOAD_ENTRY],
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set([DOWNLOAD_ENTRY.path]),
  bytesTotal: DOWNLOAD_ENTRY.size,
};

const statusEvents = (broadcaster: BundleBroadcaster) =>
  vi.mocked(broadcaster.status).mock.calls.map(([event]) => event.status);

// Blocks the download worker until the task's abort signal fires, then rejects
// with ABORTED — the real runner swallows that as a cooperative pause when
// task.paused is set, parking the sync for resume/cancel. Lets a public
// start drive an ActiveSync into a genuine PAUSED state via pause.
const blockingDownloadUntilAbort = (): void => {
  managerMocks.downloadEntry.mockImplementation(
    (_entry, _dest, options: { signal?: AbortSignal }) =>
      new Promise<void>((_resolve, reject) => {
        const fail = () => reject(new BundleError(BundleErrorCodes.ABORTED, 'download aborted'));
        if (options.signal?.aborted) {
          fail();
          return;
        }
        options.signal?.addEventListener('abort', fail, { once: true });
      }),
  );
};

beforeEach(() => {
  managerMocks.getSettings.mockReset().mockReturnValue(launcherSettings());
  managerMocks.getClient.mockReset().mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
  managerMocks.resetTaskForResume.mockReset();
  managerMocks.downloadEntry.mockReset();
  managerMocks.fetchRemoteManifest
    .mockReset()
    .mockResolvedValue({ manifest: {}, manifestHash: '0'.repeat(64) });
  managerMocks.buildPlan.mockReset().mockResolvedValue(DOWNLOAD_PLAN);
  managerMocks.loadLocalManifest.mockReset().mockResolvedValue(null);
  managerMocks.saveLocalManifest.mockReset().mockResolvedValue(undefined);
  managerMocks.logger.debug.mockReset();
});

describe('BundleManager resume cleanup', () => {
  it('drops the active sync and releases the lock when resume throws before planning', async () => {
    managerMocks.resetTaskForResume.mockImplementation(() => {
      throw new Error('re-plan setup failed');
    });
    const operationLocks = createClientOperationLocks();
    const activeSyncs: SyncStateMap = new Map();
    const manager = new BundleManager(makeBroadcaster(), makeHealer(), operationLocks, activeSyncs);
    seedPausedActiveWithLock(activeSyncs, operationLocks);

    expect(activeSyncs.has(KEY)).toBe(true);

    void manager.resume(KEY);

    await vi.waitFor(() => {
      expect(activeSyncs.has(KEY)).toBe(false);
    });

    // The CLIENT_FOLDER lease must be free again, or the key is wedged.
    const reacquire = operationLocks.acquire({
      key: KEY,
      domain: ClientOperationDomains.MINECRAFT,
      resources: [ClientOperationResources.CLIENT_FOLDER],
    });
    expect(reacquire.kind).toBe('acquired');
  });
});

describe('SyncTask phase transitions', () => {
  it('starts running', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    expect(task.phase).toBe('running');
  });

  it('treats a cancel after cancel as a no-op (stays cancelled)', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    markCancelled(task);
    markCancelled(task);
    expect(task.phase).toBe('cancelled');
  });

  it('treats a resume from running as a no-op', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    markRunning(task);
    expect(task.phase).toBe('running');
  });

  it('allows cancel from paused (cancelled overrides paused)', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    markPaused(task);
    expect(task.phase).toBe('paused');
    markCancelled(task);
    expect(task.phase).toBe('cancelled');
  });

  it('cannot pause a cancelled task (cancel is terminal)', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    markCancelled(task);
    markPaused(task);
    expect(task.phase).toBe('cancelled');
  });

  it('cannot resume a cancelled task (cancel is terminal)', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    markCancelled(task);
    markRunning(task);
    expect(task.phase).toBe('cancelled');
  });

  it('resumes a paused task back to running', () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    markPaused(task);
    markRunning(task);
    expect(task.phase).toBe('running');
  });
});

describe('runSyncPhases secondary worker errors (DLI-26)', () => {
  it('logs discarded secondary download worker errors at debug', async () => {
    const task = createSyncTask(KEY, CLIENT_FOLDER);
    task.pendingDownloads = [
      { path: 'mods/a.jar', name: 'a.jar', size: 1, isDir: false, sha256: 'a', url: 'https://t/a' },
      { path: 'mods/b.jar', name: 'b.jar', size: 1, isDir: false, sha256: 'b', url: 'https://t/b' },
    ];
    managerMocks.downloadEntry.mockRejectedValue(new Error('socket reset'));

    await expect(runSyncPhases(task, () => {})).rejects.toMatchObject({
      code: 'bundle/downloadFailed',
    });

    expect(managerMocks.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('secondary download worker error discarded'),
      expect.any(Error),
    );
  });
});

// Public-API integration: drive a real start into a genuine PAUSED state via
// pause (no seedActiveSync, no armPauseIdleTimer reflection), then exercise
// the pause-terminal branches through the public surface against the real
// runner, injected activeSyncs Map, and real operation locks. The seeded
// equivalents live in managerPauseCleanup; these prove the same branches from
// the public entry points.
describe('BundleManager pause terminal branches (public API)', () => {
  const driveToPause = async (
    broadcaster: BundleBroadcaster,
    activeSyncs: SyncStateMap,
    operationLocks: ClientOperationLocks,
  ): Promise<BundleManager> => {
    blockingDownloadUntilAbort();
    const manager = new BundleManager(broadcaster, makeHealer(), operationLocks, activeSyncs);

    void manager.start({ key: KEY });
    await vi.waitFor(() => {
      expect(managerMocks.downloadEntry).toHaveBeenCalled();
    });

    manager.pause(KEY);
    await vi.waitFor(() => {
      expect(statusEvents(broadcaster)).toContain(BundleSyncStatuses.PAUSED);
    });
    expect(activeSyncs.has(KEY)).toBe(true);
    return manager;
  };

  it('cancel after a public pause emits CANCELLED, frees the slot, and releases the lock', async () => {
    const broadcaster = makeBroadcaster();
    const activeSyncs: SyncStateMap = new Map();
    const operationLocks = createClientOperationLocks();
    const manager = await driveToPause(broadcaster, activeSyncs, operationLocks);

    manager.cancel(KEY);

    expect(activeSyncs.has(KEY)).toBe(false);
    expect(statusEvents(broadcaster)).toContain(BundleSyncStatuses.CANCELLED);
    // The write lease must be free again or the key is wedged for the session.
    const reacquire = operationLocks.acquire({
      key: KEY,
      domain: ClientOperationDomains.MINECRAFT,
      resources: [ClientOperationResources.CLIENT_FOLDER],
    });
    expect(reacquire.kind).toBe('acquired');
  });

  it('public pause arms an unref-ed real idle auto-cancel timer on the active sync', async () => {
    const broadcaster = makeBroadcaster();
    const activeSyncs: SyncStateMap = new Map();
    await driveToPause(broadcaster, activeSyncs, createClientOperationLocks());

    // The idle window (BUNDLE_PAUSED_SYNC_MAX_IDLE_MS) is too long to wait out on
    // real timers; the firing semantics are covered with fake timers in
    // managerPauseCleanup. Here we assert the public pause path arms a real timer
    // on the injected ActiveSync and unref-s it so a parked sync never blocks
    // process exit.
    expect(BUNDLE_PAUSED_SYNC_MAX_IDLE_MS).toBeGreaterThan(0);
    const timer = activeSyncs.get(KEY)?.pauseIdleTimer;
    expect(timer).not.toBeNull();
    expect(timer?.hasRef()).toBe(false);
  });

  it('cancelAll aborts a publicly paused sync and frees its slot', async () => {
    const broadcaster = makeBroadcaster();
    const activeSyncs: SyncStateMap = new Map();
    const manager = await driveToPause(broadcaster, activeSyncs, createClientOperationLocks());

    await manager.cancelAll(0);

    expect(activeSyncs.size).toBe(0);
    expect(statusEvents(broadcaster)).toContain(BundleSyncStatuses.CANCELLED);
  });
});
