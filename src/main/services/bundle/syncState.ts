import type { ClientRequest } from 'node:http';
import type { BundleProgressEvent, RemoteManifest } from '@shared/contracts/bundle';
import type { BundleSlug, ClientSlug } from '@shared/contracts/ids';
import type { SyncPlan } from './plan';
import type { SyncTask } from './runner';

export type ActiveSync = {
  task: SyncTask;
  lastProgress: BundleProgressEvent | null;
  remoteManifestHash: string;
  remoteManifest: RemoteManifest;
  bundleSlug: BundleSlug;
  forLaunch: boolean;
  awaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  pauseIdleTimer: NodeJS.Timeout | null;
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
  bundleSlug: BundleSlug,
  forLaunch: boolean,
): ActiveSync => ({
  task,
  lastProgress: null,
  remoteManifestHash: '',
  remoteManifest: {},
  bundleSlug,
  forLaunch,
  awaiters: [],
  pauseIdleTimer: null,
});

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
