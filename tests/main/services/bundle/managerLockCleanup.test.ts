import { beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  return {
    buildPlan: vi.fn(),
    fetchRemoteManifest: vi.fn(),
    getClient: vi.fn(),
    getSettings: vi.fn(),
    loadLocalManifest: vi.fn(),
    runSyncPhases: vi.fn(),
    saveLocalManifest: vi.fn(),
    createSyncTask: vi.fn(),
  };
});

import { BundleManager } from '@main/services/bundle/manager';
import {
  ClientOperationDomains,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';
import { makeBroadcaster, makeHealer, makeLauncherSettings } from '../../../helpers/fixtures';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/clients', () => ({
  getClient: managerMocks.getClient,
}));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: managerMocks.getSettings,
}));

vi.mock('@main/services/bundle/api', () => ({
  fetchRemoteManifest: managerMocks.fetchRemoteManifest,
}));

vi.mock('@main/services/bundle/manifestRepo', () => ({
  clearLocalManifest: vi.fn(),
  loadLocalManifest: managerMocks.loadLocalManifest,
  saveLocalManifest: managerMocks.saveLocalManifest,
}));

vi.mock('@main/services/bundle/plan', () => ({
  buildPlan: managerMocks.buildPlan,
}));

vi.mock('@main/services/bundle/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/bundle/runner')>();
  return { ...actual, runSyncPhases: managerMocks.runSyncPhases };
});

vi.mock('@main/services/bundle/syncState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/bundle/syncState')>();
  return {
    ...actual,
    createSyncTask: (...args: Parameters<typeof actual.createSyncTask>) =>
      managerMocks.createSyncTask(...args),
  };
});

const { createSyncTask: realCreateSyncTask } = await vi.importActual<
  typeof import('@main/services/bundle/syncState')
>('@main/services/bundle/syncState');

const KEY = asCatalogKey('official:test-client');
const BUNDLE_SLUG = 'bundle-x';
const CLIENT_FOLDER = '/tmp/client';

const launcherSettings = () =>
  makeLauncherSettings({ clients: { [KEY]: { storage: { clientFolder: CLIENT_FOLDER } } } });

const EMPTY_PLAN = {
  toDownload: [],
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set<string>(),
  bytesTotal: 0,
};

const isBundleLockFree = (locks: ReturnType<typeof createClientOperationLocks>): boolean => {
  const probe = locks.acquire({
    key: KEY,
    domain: ClientOperationDomains.BUNDLE,
    resources: [ClientOperationResources.CLIENT_FOLDER, ClientOperationResources.BUNDLE_MANIFEST],
  });
  if (probe.kind !== 'acquired') return false;
  probe.lease.release();
  return true;
};

beforeEach(() => {
  managerMocks.buildPlan.mockReset().mockResolvedValue(EMPTY_PLAN);
  managerMocks.fetchRemoteManifest
    .mockReset()
    .mockResolvedValue({ manifest: {}, manifestHash: 'empty-manifest-hash' });
  managerMocks.getClient.mockReset().mockResolvedValue({ bundleSlug: BUNDLE_SLUG });
  managerMocks.getSettings.mockReset().mockReturnValue(launcherSettings());
  managerMocks.loadLocalManifest.mockReset().mockResolvedValue(null);
  managerMocks.runSyncPhases.mockReset().mockResolvedValue({ deletedAny: false });
  managerMocks.saveLocalManifest.mockReset().mockResolvedValue(undefined);
  managerMocks.createSyncTask.mockReset().mockImplementation(realCreateSyncTask);
});

describe('BundleManager lock + awaiter cleanup', () => {
  it('resolves a forLaunch sync and frees the lock even when the manifest write fails', async () => {
    const locks = createClientOperationLocks();
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer(), locks);
    managerMocks.saveLocalManifest.mockRejectedValue(new Error('disk full'));

    await expect(manager.syncForLaunch(KEY)).resolves.toBeUndefined();

    const statuses = vi.mocked(broadcaster.status).mock.calls.map(([event]) => event.status);
    expect(statuses).toContain(BundleSyncStatuses.UP_TO_DATE);
    expect(isBundleLockFree(locks)).toBe(true);
  });

  it('releases the lock when sync setup throws before cleanup is wired', async () => {
    const locks = createClientOperationLocks();
    const manager = new BundleManager(makeBroadcaster(), makeHealer(), locks);
    managerMocks.createSyncTask.mockImplementation(() => {
      throw new Error('task construction blew up');
    });

    await expect(manager.start({ key: KEY })).rejects.toThrow('task construction blew up');

    expect(isBundleLockFree(locks)).toBe(true);
  });
});
