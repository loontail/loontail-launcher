import type { ClientRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const managerMocks = vi.hoisted(() => {
  process.env.API_URL ??= 'http://test.invalid';
  process.env.API_TOKEN ??= 'test-token';
  return {
    buildPlan: vi.fn(),
    clearLocalManifest: vi.fn(),
    fetchRemoteManifest: vi.fn(),
    getClient: vi.fn(),
    getSettings: vi.fn(),
    loadLocalManifest: vi.fn(),
    saveLocalManifest: vi.fn(),
  };
});

import { BUNDLE_PAUSED_SYNC_MAX_IDLE_MS } from '@main/constants/bundle';
import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import type { Healer } from '@main/services/bundle/healer';
import { BundleManager } from '@main/services/bundle/manager';
import type { SyncPlan } from '@main/services/bundle/plan';
import type { SyncTask } from '@main/services/bundle/runner';
import { BundleErrorCodes, BundleSyncStatuses } from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';

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
  clearLocalManifest: managerMocks.clearLocalManifest,
  loadLocalManifest: managerMocks.loadLocalManifest,
  saveLocalManifest: managerMocks.saveLocalManifest,
}));

vi.mock('@main/services/bundle/plan', () => ({
  buildPlan: managerMocks.buildPlan,
}));

type Awaiter = { resolve: () => void; reject: (err: Error) => void };

type ActiveSyncShape = {
  task: SyncTask;
  lastProgress: null;
  remoteManifestHash: string;
  remoteManifest: Record<string, never>;
  bundleSlug: string;
  forLaunch: boolean;
  awaiters: Awaiter[];
  pauseIdleTimer: NodeJS.Timeout | null;
};

const SLUG = 'test-client' as ClientSlug;
const BUNDLE_SLUG = 'bundle-x';
const CLIENT_FOLDER = '/tmp/client';

const EMPTY_PLAN: SyncPlan = {
  toDownload: [],
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set(),
  bytesTotal: 0,
};

const launcherSettings = (): LauncherSettings => ({
  memory: { allocatedRamMb: 0 },
  storage: { clientsFolder: '/tmp/clients' },
  launch: { console: false, fullscreen: false },
  clients: {
    [SLUG]: { storage: { clientFolder: CLIENT_FOLDER } },
  },
});

const makeBroadcaster = (): BundleBroadcaster => ({
  status: vi.fn(),
  progress: vi.fn(),
  error: vi.fn(),
});

const makeHealer = (): Healer =>
  ({
    healAfterDeletes: vi.fn(async () => {}),
  }) as unknown as Healer;

const seedPausedActive = (
  manager: BundleManager,
  awaiter: Awaiter,
): { activeSyncs: Map<ClientSlug, ActiveSyncShape> } => {
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
  const active: ActiveSyncShape = {
    task,
    lastProgress: null,
    remoteManifestHash: '',
    remoteManifest: {},
    bundleSlug: BUNDLE_SLUG,
    forLaunch: true,
    awaiters: [awaiter],
    pauseIdleTimer: null,
  };
  const internals = manager as unknown as {
    activeSyncs: Map<ClientSlug, ActiveSyncShape>;
    armPauseIdleTimer: (slug: ClientSlug, active: ActiveSyncShape) => void;
  };
  internals.activeSyncs.set(SLUG, active);
  internals.armPauseIdleTimer.call(manager, SLUG, active);
  return { activeSyncs: internals.activeSyncs };
};

const resetManagerMocks = (): void => {
  managerMocks.buildPlan.mockReset();
  managerMocks.clearLocalManifest.mockReset();
  managerMocks.fetchRemoteManifest.mockReset();
  managerMocks.getClient.mockReset();
  managerMocks.getSettings.mockReset();
  managerMocks.loadLocalManifest.mockReset();
  managerMocks.saveLocalManifest.mockReset();

  managerMocks.buildPlan.mockResolvedValue(EMPTY_PLAN);
  managerMocks.clearLocalManifest.mockResolvedValue(undefined);
  managerMocks.fetchRemoteManifest.mockResolvedValue({
    manifest: {},
    manifestHash: 'empty-manifest-hash',
  });
  managerMocks.getClient.mockResolvedValue(null);
  managerMocks.getSettings.mockReturnValue(launcherSettings());
  managerMocks.loadLocalManifest.mockResolvedValue(null);
  managerMocks.saveLocalManifest.mockResolvedValue(undefined);
};

const statusEvents = (broadcaster: BundleBroadcaster) =>
  vi.mocked(broadcaster.status).mock.calls.map(([event]) => event.status);

describe('BundleManager pause cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetManagerMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel after pause rejects awaiters and frees the slot', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const rejected: Error[] = [];
    const awaiter: Awaiter = {
      resolve: () => {
        throw new Error('should not resolve');
      },
      reject: (err) => rejected.push(err),
    };

    const { activeSyncs } = seedPausedActive(manager, awaiter);
    expect(activeSyncs.has(SLUG)).toBe(true);

    manager.cancelSync(SLUG);

    expect(activeSyncs.has(SLUG)).toBe(false);
    expect(rejected).toHaveLength(1);
    const err = rejected[0] as Error & { code?: string };
    expect(err.code).toBe(BundleErrorCodes.ABORTED);
    expect(broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: BundleSyncStatuses.CANCELLED,
    });
  });

  it('cancelAll aborts every active sync and frees all slots', async () => {
    vi.useRealTimers();
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const rejected: Error[] = [];
    seedPausedActive(manager, {
      resolve: () => {
        throw new Error('should not resolve');
      },
      reject: (err) => rejected.push(err),
    });
    const internals = manager as unknown as {
      activeSyncs: Map<ClientSlug, ActiveSyncShape>;
    };
    expect(internals.activeSyncs.size).toBe(1);

    await manager.cancelAll(0);

    expect(internals.activeSyncs.size).toBe(0);
    expect(rejected).toHaveLength(1);
  });

  it('idle timeout drops paused entry and rejects awaiters', async () => {
    const broadcaster = makeBroadcaster();
    const manager = new BundleManager(broadcaster, makeHealer());
    const rejected: Error[] = [];
    const awaiter: Awaiter = {
      resolve: () => {
        throw new Error('should not resolve');
      },
      reject: (err) => rejected.push(err),
    };

    const { activeSyncs } = seedPausedActive(manager, awaiter);
    expect(activeSyncs.has(SLUG)).toBe(true);

    vi.advanceTimersByTime(BUNDLE_PAUSED_SYNC_MAX_IDLE_MS + 1);

    expect(activeSyncs.has(SLUG)).toBe(false);
    expect(rejected).toHaveLength(1);
    const err = rejected[0] as Error & { code?: string };
    expect(err.code).toBe(BundleErrorCodes.ABORTED);
    expect(broadcaster.status).toHaveBeenCalledWith({
      slug: SLUG,
      status: BundleSyncStatuses.CANCELLED,
    });
  });

  it('resume emits the same terminal status as a fresh sync for an empty plan', async () => {
    vi.useRealTimers();
    managerMocks.getClient.mockResolvedValue({ bundleSlug: BUNDLE_SLUG });

    const freshBroadcaster = makeBroadcaster();
    const freshManager = new BundleManager(freshBroadcaster, makeHealer());

    await freshManager.startSync({ slug: SLUG });

    const freshStatuses = statusEvents(freshBroadcaster);
    expect(freshStatuses).toEqual([
      BundleSyncStatuses.FETCHING_MANIFEST,
      BundleSyncStatuses.PLANNING,
      BundleSyncStatuses.UP_TO_DATE,
    ]);

    const resumeBroadcaster = makeBroadcaster();
    const resumeManager = new BundleManager(resumeBroadcaster, makeHealer());
    const resolved: string[] = [];
    const { activeSyncs } = seedPausedActive(resumeManager, {
      resolve: () => resolved.push('resolved'),
      reject: (err) => {
        throw err;
      },
    });

    resumeManager.resumeSync(SLUG);

    await vi.waitFor(() => {
      expect(activeSyncs.has(SLUG)).toBe(false);
    });

    const resumeStatuses = statusEvents(resumeBroadcaster);
    expect(resumeStatuses).toEqual([BundleSyncStatuses.PLANNING, BundleSyncStatuses.UP_TO_DATE]);
    expect(resumeStatuses.at(-1)).toBe(freshStatuses.at(-1));
    expect(resolved).toEqual(['resolved']);
  });
});
