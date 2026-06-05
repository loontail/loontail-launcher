import type { ClientRequest } from 'node:http';
import type { ClientOperationLease } from '@main/services/clientOperationLocks';
import type { BundleProgressEvent, RemoteManifest } from '@shared/contracts/bundle';
import type { BundleSlug, ClientSlug } from '@shared/contracts/ids';
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

export const createSyncTask = (slug: ClientSlug, clientFolder: string): SyncTask => ({
  slug,
  clientFolder,
  plan: createEmptySyncPlan(),
  abort: new AbortController(),
  currentRequests: new Set<ClientRequest>(),
  paused: false,
  cancelled: false,
  bytesDownloaded: 0,
  speedWindowStart: Date.now(),
  speedWindowBytes: 0,
  processedFiles: 0,
  totalFiles: 0,
  lastEmittedAt: 0,
  pendingDownloads: [],
  pendingDeletes: [],
});

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
  task.paused = false;
  task.cancelled = false;
  task.abort = new AbortController();
  task.currentRequests = new Set<ClientRequest>();
  task.bytesDownloaded = 0;
  task.processedFiles = 0;
  task.lastEmittedAt = 0;
  task.speedWindowStart = Date.now();
  task.speedWindowBytes = 0;
};
