import type { ClientRequest } from 'node:http';
import {
  ClientOperationDomains,
  type ClientOperationLease,
} from '@main/services/clientOperationLocks';
import type { BundleProgressEvent, RemoteManifest } from '@shared/contracts/bundle';
import type { BundleSlug, CatalogKey } from '@shared/contracts/ids';
import type { SyncPlan } from './plan';
import type { SyncTask } from './runner';

export type ActiveSync = {
  task: SyncTask;
  // Lock + sync state are one record so the slug cannot be removed from
  // activeSyncs without releasing the lease (dropActiveSync owns both).
  lock: ClientOperationLease;
  lastProgress: BundleProgressEvent | null;
  remoteManifestHash: string;
  remoteManifest: RemoteManifest;
  bundleSlug: BundleSlug;
  forLaunch: boolean;
  awaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  pauseIdleTimer: NodeJS.Timeout | null;
  // Resolves once the sync leaves activeSyncs (used by cancelAll to await real
  // completion instead of a fixed grace timer).
  whenDropped: Promise<void>;
  signalDropped: () => void;
};

const createEmptySyncPlan = (): SyncPlan => ({
  toDownload: [],
  toUpdate: [],
  toDelete: [],
  toSkip: [],
  bundleOwnedRelativePaths: new Set(),
  bytesTotal: 0,
});

export type SyncPhase = 'running' | 'paused' | 'cancelled';

// Cancel overrides pause: a paused sync can still be cancelled (cancelSync's
// wasPaused drop path), but a cancelled sync is terminal and never reverts.
export const markPaused = (task: SyncTask): void => {
  if (task.phase === 'running') task.phase = 'paused';
};

export const markCancelled = (task: SyncTask): void => {
  task.phase = 'cancelled';
};

export const markRunning = (task: SyncTask): void => {
  if (task.phase === 'paused') task.phase = 'running';
};

export const createSyncTask = (slug: CatalogKey, clientFolder: string): SyncTask => {
  const task: SyncTask = {
    slug,
    clientFolder,
    plan: createEmptySyncPlan(),
    abort: new AbortController(),
    currentRequests: new Set<ClientRequest>(),
    phase: 'running',
    get paused() {
      return task.phase === 'paused';
    },
    set paused(value: boolean) {
      if (value) markPaused(task);
      else markRunning(task);
    },
    get cancelled() {
      return task.phase === 'cancelled';
    },
    // Cancellation is terminal: a `false` write is a no-op (use markRunning to
    // resume a paused task) so the compat setter can never revive a cancel.
    set cancelled(value: boolean) {
      if (value) markCancelled(task);
    },
    bytesDownloaded: 0,
    speedWindowStart: Date.now(),
    speedWindowBytes: 0,
    processedFiles: 0,
    totalFiles: 0,
    lastEmittedAt: 0,
    pendingDownloads: [],
    pendingDeletes: [],
  };
  return task;
};

export const createActiveSync = (
  task: SyncTask,
  lock: ClientOperationLease,
  bundleSlug: BundleSlug,
  forLaunch: boolean,
): ActiveSync => {
  let signalDropped: () => void = () => {};
  const whenDropped = new Promise<void>((resolve) => {
    signalDropped = resolve;
  });
  return {
    task,
    lock,
    lastProgress: null,
    remoteManifestHash: '',
    remoteManifest: {},
    bundleSlug,
    forLaunch,
    awaiters: [],
    pauseIdleTimer: null,
    whenDropped,
    signalDropped,
  };
};

// Resume only runs after pause has fully drained the download workers
// (runSyncPhases returned), so reassigning task.abort here cannot strand a live
// worker on the old signal — each downloadEntry captured the previous signal by
// value for its lifetime.
export const resetTaskForResume = (task: SyncTask): void => {
  markRunning(task);
  task.abort = new AbortController();
  task.currentRequests = new Set<ClientRequest>();
  task.bytesDownloaded = 0;
  task.processedFiles = 0;
  task.lastEmittedAt = 0;
  task.speedWindowStart = Date.now();
  task.speedWindowBytes = 0;
};

export class SyncStateStore {
  private readonly entries = new Map<CatalogKey, ActiveSync>();

  get(slug: CatalogKey): ActiveSync | undefined {
    return this.entries.get(slug);
  }

  set(slug: CatalogKey, active: ActiveSync): void {
    this.entries.set(slug, active);
  }

  delete(slug: CatalogKey): boolean {
    return this.entries.delete(slug);
  }

  has(slug: CatalogKey): boolean {
    return this.entries.has(slug);
  }

  get size(): number {
    return this.entries.size;
  }

  values(): IterableIterator<ActiveSync> {
    return this.entries.values();
  }
}

const noopLease = (slug: CatalogKey): ClientOperationLease => ({
  slug,
  domain: ClientOperationDomains.BUNDLE,
  resources: [],
  setCancel: () => {},
  release: () => {},
});

// Test-only: builds an ActiveSync through the real createSyncTask/createActiveSync
// so the seeded record shape lives in one place and tracks ActiveSync at compile
// time. A real ClientOperationLease can be supplied when the test asserts on lock
// release; otherwise a no-op lease is used.
export const seedActiveSync = (
  store: SyncStateStore,
  opts: {
    slug: CatalogKey;
    clientFolder: string;
    bundleSlug: BundleSlug;
    forLaunch: boolean;
    paused?: boolean;
    lock?: ClientOperationLease;
  },
): ActiveSync => {
  const task = createSyncTask(opts.slug, opts.clientFolder);
  if (opts.paused) markPaused(task);
  const active = createActiveSync(
    task,
    opts.lock ?? noopLease(opts.slug),
    opts.bundleSlug,
    opts.forLaunch,
  );
  store.set(opts.slug, active);
  return active;
};
