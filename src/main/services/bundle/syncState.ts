import type { ClientRequest } from 'node:http';
import { markRunning } from '@main/infra/lifecyclePhase';
import type { ClientOperationLease } from '@main/services/clientOperationLocks';
import type { BundleProgressEvent, RemoteManifest } from '@shared/contracts/bundle';
import type { BundleSlug, CatalogKey } from '@shared/contracts/ids';
import type { SyncPlan } from './plan';
import type { SyncTask } from './runner';

export type ActiveSync = {
  task: SyncTask;
  // Lock + state are one record so a key can't leave activeSyncs without
  // releasing the lease (dropActiveSync owns both).
  lock: ClientOperationLease;
  lastProgress: BundleProgressEvent | null;
  remoteManifestHash: string;
  remoteManifest: RemoteManifest;
  bundleSlug: BundleSlug;
  forLaunch: boolean;
  awaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  pauseIdleTimer: NodeJS.Timeout | null;
  // Resolves once the sync leaves activeSyncs; cancelAll awaits this for real
  // completion instead of a fixed grace timer.
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

export const createSyncTask = (key: CatalogKey, clientFolder: string): SyncTask => {
  const task: SyncTask = {
    key,
    clientFolder,
    plan: createEmptySyncPlan(),
    abort: new AbortController(),
    currentRequests: new Set<ClientRequest>(),
    phase: 'running',
    bytesDownloaded: 0,
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

// Resume only runs after pause drained the workers (runSyncPhases returned), so
// reassigning task.abort here can't strand a live worker on the old signal.
export const resetTaskForResume = (task: SyncTask): void => {
  markRunning(task);
  task.abort = new AbortController();
  task.currentRequests = new Set<ClientRequest>();
  task.bytesDownloaded = 0;
  task.processedFiles = 0;
  task.lastEmittedAt = 0;
};

export type SyncStateMap = Map<CatalogKey, ActiveSync>;
