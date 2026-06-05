import type { ClientRequest } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    getSettings: vi.fn(),
    resetTaskForResume: vi.fn(),
  };
});

import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import type { Healer } from '@main/services/bundle/healer';
import { BundleManager } from '@main/services/bundle/manager';
import type { SyncTask } from '@main/services/bundle/runner';
import {
  ClientOperationDomains,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import type { ClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';

vi.mock('@main/infra/logger', () => ({
  scopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@main/services/clients', () => ({ getClient: vi.fn() }));

vi.mock('@main/services/settings/settings', () => ({
  getSettings: managerMocks.getSettings,
}));

vi.mock('@main/services/bundle/syncState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/bundle/syncState')>();
  return { ...actual, resetTaskForResume: managerMocks.resetTaskForResume };
});

const SLUG = 'test-client' as ClientSlug;
const BUNDLE_SLUG = 'bundle-x';
const CLIENT_FOLDER = '/tmp/client';

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '/tmp/clients' },
  launch: { console: false, fullscreen: false },
  clients: { [SLUG]: { storage: { clientFolder: CLIENT_FOLDER } } },
});

const makeBroadcaster = (): BundleBroadcaster => ({
  status: vi.fn(),
  progress: vi.fn(),
  error: vi.fn(),
});

const makeHealer = (): Healer => ({ healAfterDeletes: vi.fn(async () => {}) }) as unknown as Healer;

type ManagerInternals = {
  activeSyncs: Map<ClientSlug, { lock: { release: () => void } }>;
};

const seedPausedActiveWithLock = (
  manager: BundleManager,
  operationLocks: ClientOperationLocks,
): ManagerInternals => {
  const task: SyncTask = {
    slug: SLUG,
    clientFolder: CLIENT_FOLDER,
    plan: {
      toDownload: [],
      toUpdate: [],
      toDelete: [],
      toSkip: [],
      bundleOwnedRelativePaths: new Set(),
      bytesTotal: 0,
    },
    abort: new AbortController(),
    currentRequests: new Set<ClientRequest>(),
    paused: true,
    cancelled: false,
    bytesDownloaded: 0,
    speedWindowStart: 0,
    speedWindowBytes: 0,
    processedFiles: 0,
    totalFiles: 0,
    lastEmittedAt: 0,
    pendingDownloads: [],
    pendingDeletes: [],
  };
  const acquired = operationLocks.acquire({
    slug: SLUG,
    domain: ClientOperationDomains.BUNDLE,
    resources: [ClientOperationResources.CLIENT_FOLDER],
  });
  if (acquired.kind !== 'acquired') throw new Error('Expected bundle lock');

  const active = {
    task,
    lock: acquired.lease,
    lastProgress: null,
    remoteManifestHash: '',
    remoteManifest: {},
    bundleSlug: BUNDLE_SLUG,
    forLaunch: false,
    awaiters: [],
    pauseIdleTimer: null,
    whenDropped: Promise.resolve(),
    signalDropped: () => {},
  };

  const internals = manager as unknown as ManagerInternals;
  internals.activeSyncs.set(SLUG, active);
  return internals;
};

beforeEach(() => {
  managerMocks.getSettings.mockReset().mockReturnValue(launcherSettings());
  managerMocks.resetTaskForResume.mockReset();
});

describe('BundleManager resume cleanup', () => {
  it('drops the active sync and releases the lock when resume throws before planning', async () => {
    managerMocks.resetTaskForResume.mockImplementation(() => {
      throw new Error('re-plan setup failed');
    });
    const operationLocks = createClientOperationLocks();
    const manager = new BundleManager(makeBroadcaster(), makeHealer(), operationLocks);
    const internals = seedPausedActiveWithLock(manager, operationLocks);

    expect(internals.activeSyncs.has(SLUG)).toBe(true);

    void manager.resumeSync(SLUG);

    await vi.waitFor(() => {
      expect(internals.activeSyncs.has(SLUG)).toBe(false);
    });

    // The CLIENT_FOLDER lease must be free again, or the slug is wedged.
    const reacquire = operationLocks.acquire({
      slug: SLUG,
      domain: ClientOperationDomains.MINECRAFT,
      resources: [ClientOperationResources.CLIENT_FOLDER],
    });
    expect(reacquire.kind).toBe('acquired');
  });
});
