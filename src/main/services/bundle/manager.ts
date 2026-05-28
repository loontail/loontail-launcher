import type { ClientRequest } from 'node:http';
import { EventTypes, type ProgressListener } from '@loontail/minecraft-kit';
import { BUNDLE_PAUSED_SYNC_MAX_IDLE_MS } from '@main/constants/bundle';
import { scopedLogger } from '@main/infra/logger';
import { getClient } from '@main/services/clients';
import { getSettings } from '@main/services/settings/settings';
import {
  type BundleErrorCode,
  BundleErrorCodes,
  type BundleInstallState,
  type BundleProgressEvent,
  type BundleStartRequest,
  type BundleSyncStatus,
  BundleSyncStatuses,
  type LocalManifest,
  type RemoteManifest,
} from '@shared/contracts/bundle';
import type { ClientSlug } from '@shared/contracts/ids';
import { resolveClientSettings } from '@shared/domain/settings';
import { fetchRemoteManifest } from './api';
import type { BundleBroadcaster } from './broadcast';
import { BundleError, classifyBundleError, errorMessage } from './errors';
import type { Healer } from './healer';
import { clearLocalManifest, loadLocalManifest, saveLocalManifest } from './manifestRepo';
import { normalizePathForSet } from './paths';
import { type SyncPlan, buildPlan } from './plan';
import { type EmitProgress, type SyncTask, runSyncPhases } from './runner';

const logger = scopedLogger('bundle.manager');

const HEAL_PROGRESS_THROTTLE_MS = 100;

// Wrap kit verify/repair events into the manager's emit() so the renderer
// sees the HEALING status with live file counts (during verify) and a moving
// byte total (during repair). The kit does not announce verify totals up-front;
// we surface `verifiedFiles` as `processedFiles` and leave `totalFiles` at the
// task's last known value, mirroring how DELETING phase reuses task totals.
const createHealProgressListener = (slug: ClientSlug, emit: EmitProgress): ProgressListener => {
  let verifiedFiles = 0;
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let currentFile: string | undefined;
  let lastEmittedAt = 0;
  let pendingFlush: NodeJS.Timeout | null = null;

  const flush = (): void => {
    lastEmittedAt = Date.now();
    pendingFlush = null;
    emit(slug, BundleSyncStatuses.HEALING, {
      processedFiles: verifiedFiles,
      ...(totalBytes > 0 ? { bytesDownloaded, bytesTotal: totalBytes } : {}),
      ...(currentFile !== undefined ? { currentFile } : {}),
    });
  };

  const scheduleFlush = (): void => {
    const elapsed = Date.now() - lastEmittedAt;
    if (elapsed >= HEAL_PROGRESS_THROTTLE_MS) {
      if (pendingFlush !== null) {
        clearTimeout(pendingFlush);
        pendingFlush = null;
      }
      flush();
    } else if (pendingFlush === null) {
      pendingFlush = setTimeout(flush, HEAL_PROGRESS_THROTTLE_MS - elapsed);
    }
  };

  return (event) => {
    switch (event.type) {
      case EventTypes.VERIFY_FILE_CHECKED:
        verifiedFiles += 1;
        currentFile = event.file.path;
        scheduleFlush();
        return;
      case EventTypes.DOWNLOAD_STARTED:
        currentFile = event.file.target;
        scheduleFlush();
        return;
      case EventTypes.DOWNLOAD_PROGRESS:
        bytesDownloaded = event.bytesDownloaded;
        totalBytes = event.totalBytes;
        currentFile = event.file.target;
        scheduleFlush();
        return;
      default:
        return;
    }
  };
};

type ActiveSync = {
  task: SyncTask;
  // Latest progress snapshot — surfaced to renderer via checkStatus.
  lastProgress: BundleProgressEvent | null;
  // Last fetched remote manifest hash (used to write local manifest on success).
  remoteManifestHash: string;
  // Last fetched remote manifest (used by healer + local manifest writer).
  remoteManifest: RemoteManifest;
  // Snapshot of bundle slug for diagnostics.
  bundleSlug: string;
  // True when this op was triggered as the implicit pre-launch sync; surfaces
  // through syncForLaunch resolution semantics.
  forLaunch: boolean;
  // Pending launch promise (resolved/rejected when the sync terminates so
  // syncForLaunch callers can await termination).
  awaiters: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  // Idle timer armed while the sync is paused; clears the activeSyncs slot if
  // the user never resumes/cancels. Cleared on resume, cancel, or expiry.
  pauseIdleTimer: NodeJS.Timeout | null;
};

const flattenRemote = (
  manifest: RemoteManifest,
): { files: Record<string, { sha256: string; size: number }> } => {
  const files: Record<string, { sha256: string; size: number }> = {};
  for (const entries of Object.values(manifest)) {
    for (const entry of entries) {
      if (entry.isDir) continue;
      if (!entry.sha256) continue;
      files[normalizePathForSet(entry.path)] = { sha256: entry.sha256, size: entry.size };
    }
  }
  return { files };
};

const makeProgressEvent = (
  task: SyncTask,
  slug: ClientSlug,
  status: BundleSyncStatus,
  patch?: Partial<BundleProgressEvent>,
): BundleProgressEvent => ({
  slug,
  status,
  processedFiles: patch?.processedFiles ?? task.processedFiles,
  totalFiles: patch?.totalFiles ?? task.totalFiles,
  toDownload: patch?.toDownload ?? task.plan.toDownload.length + task.plan.toUpdate.length,
  toUpdate: patch?.toUpdate ?? task.plan.toUpdate.length,
  toDelete: patch?.toDelete ?? task.plan.toDelete.length,
  toSkip: patch?.toSkip ?? task.plan.toSkip.length,
  bytesDownloaded: patch?.bytesDownloaded ?? task.bytesDownloaded,
  bytesTotal: patch?.bytesTotal ?? task.plan.bytesTotal,
  speedBytesPerSec: patch?.speedBytesPerSec ?? 0,
  ...(patch?.currentFile ? { currentFile: patch.currentFile } : {}),
});

const createEmit = (
  active: ActiveSync,
  task: SyncTask,
  emitProgress: (event: BundleProgressEvent) => void,
): EmitProgress => {
  return (slug, status, patch) => {
    const event = makeProgressEvent(task, slug, status, patch);
    active.lastProgress = event;
    emitProgress(event);
  };
};

export class BundleManager {
  private readonly activeSyncs = new Map<ClientSlug, ActiveSync>();

  constructor(
    private readonly broadcaster: BundleBroadcaster,
    private readonly healer: Healer,
  ) {}

  // Public API ---------------------------------------------------------------

  async startSync(req: BundleStartRequest): Promise<void> {
    await this.runSync(req, { forLaunch: false });
  }

  // Called by MinecraftManager.startLaunch after the install step. Awaits the
  // sync to terminal status (completed/up-to-date) before letting launch
  // proceed. No-op when the client has no bundleSlug. Errors propagate so the
  // caller can abort launch.
  async syncForLaunch(slug: ClientSlug, externalSignal?: AbortSignal): Promise<void> {
    if (externalSignal?.aborted) {
      throw new BundleError(BundleErrorCodes.ABORTED, 'Sync aborted before start');
    }
    const onExternalAbort = () => {
      this.cancelSync(slug);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      await this.runSync({ slug }, { forLaunch: true });
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  pauseSync(slug: ClientSlug): void {
    const active = this.activeSyncs.get(slug);
    if (!active) return;
    if (active.task.cancelled) return;
    active.task.paused = true;
    // Abort current downloads — workers will see the BundleError, swallow it
    // because task.paused === true, and exit cleanly leaving partial state.
    active.task.abort.abort();
    this.emitStatus(slug, BundleSyncStatuses.PAUSED);
    this.armPauseIdleTimer(slug, active);
  }

  resumeSync(slug: ClientSlug): void {
    const active = this.activeSyncs.get(slug);
    if (!active) {
      // Nothing pending — caller probably wants a fresh sync. Spawn one.
      void this.startSync({ slug }).catch((err) => {
        logger.warn(`[${slug}] resume → fresh sync failed`, err);
      });
      return;
    }
    if (active.task.cancelled) return;
    if (!active.task.paused) return;
    this.clearPauseIdleTimer(active);
    // Re-plan from current disk state — if files were finished before pause,
    // they're now hash-matched and will be skipped.
    void this.continuePausedSync(active).catch((err) => {
      logger.warn(`[${slug}] resume failed`, err);
    });
  }

  cancelSync(slug: ClientSlug): void {
    const active = this.activeSyncs.get(slug);
    if (!active) return;
    this.clearPauseIdleTimer(active);
    const wasPaused = active.task.paused;
    active.task.cancelled = true;
    active.task.abort.abort();
    // Destroy any sockets the runner might still hold (defensive — abort()
    // should already have triggered cleanup via the signal listener).
    for (const req of active.task.currentRequests) {
      req.destroy();
    }
    active.task.currentRequests.clear();
    // If the sync was paused, runSync has already exited and won't run its
    // finally cleanup again — handle the rejection + map deletion inline.
    // Otherwise the runSync finally block does it.
    if (wasPaused) {
      this.emitStatus(slug, BundleSyncStatuses.CANCELLED);
      this.rejectAwaiters(
        active,
        new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled while paused'),
      );
      this.activeSyncs.delete(slug);
    }
  }

  async getInstallState(slug: ClientSlug): Promise<BundleInstallState> {
    const active = this.activeSyncs.get(slug);
    if (active) {
      return {
        installed: false,
        signatureMatches: true,
        progress: active.lastProgress,
      };
    }
    const client = await this.tryGetClient(slug);
    if (!client?.bundleSlug) {
      return { installed: true, signatureMatches: true, progress: null };
    }
    const clientFolder = this.resolveClientFolder(slug);
    if (!clientFolder) {
      return { installed: false, signatureMatches: true, progress: null };
    }
    const local = await loadLocalManifest(clientFolder);
    if (!local) {
      return { installed: false, signatureMatches: false, progress: null };
    }
    // Best-effort drift check. If the network is down, we don't want to gate
    // the UI on it — return signatureMatches=true and let the next sync sort
    // it out.
    let signatureMatches = true;
    try {
      const { manifestHash } = await fetchRemoteManifest(client.bundleSlug);
      signatureMatches = manifestHash === local.manifestHash;
    } catch (err) {
      logger.warn(`[${slug}] checkStatus: manifest fetch failed, assuming up-to-date`, err);
    }
    return { installed: true, signatureMatches, progress: null };
  }

  // Internal -----------------------------------------------------------------

  private async runSync(req: BundleStartRequest, options: { forLaunch: boolean }): Promise<void> {
    const { slug } = req;
    if (this.activeSyncs.has(slug)) {
      throw new BundleError(
        BundleErrorCodes.OP_IN_FLIGHT,
        'A bundle sync is already running for this client',
      );
    }
    const client = await this.tryGetClient(slug);
    if (!client) {
      throw new BundleError(BundleErrorCodes.UNKNOWN, `Client "${slug}" not found`);
    }
    const bundleSlug = client.bundleSlug ?? null;
    if (!bundleSlug) {
      // No bundle attached — treat as a successful no-op so launch can proceed.
      this.emitStatus(slug, BundleSyncStatuses.NO_BUNDLE);
      return;
    }
    const clientFolder = this.resolveClientFolder(slug);
    if (!clientFolder) {
      throw new BundleError(
        BundleErrorCodes.NO_CLIENT_FOLDER,
        'Set the launcher install folder in System settings first',
      );
    }
    const abort = new AbortController();
    const currentRequests = new Set<ClientRequest>();
    const task: SyncTask = {
      slug,
      clientFolder,
      // Filled in after the planning step below.
      plan: {
        toDownload: [],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
        bundleOwnedRelativePaths: new Set(),
        bytesTotal: 0,
      },
      abort,
      currentRequests,
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
    };
    const active: ActiveSync = {
      task,
      lastProgress: null,
      remoteManifestHash: '',
      remoteManifest: {},
      bundleSlug,
      forLaunch: options.forLaunch,
      awaiters: [],
      pauseIdleTimer: null,
    };
    this.activeSyncs.set(slug, active);

    const emit: EmitProgress = createEmit(active, task, (event) => {
      this.broadcaster.progress(event);
    });

    try {
      this.emitStatus(slug, BundleSyncStatuses.FETCHING_MANIFEST);
      const { manifest, manifestHash } = await fetchRemoteManifest(bundleSlug, abort.signal);
      active.remoteManifest = manifest;
      active.remoteManifestHash = manifestHash;

      this.emitStatus(slug, BundleSyncStatuses.PLANNING);
      const local = await loadLocalManifest(clientFolder);
      const plan = await buildPlan(manifest, local, clientFolder, { force: req.force === true });
      task.plan = plan;
      task.pendingDownloads = [...plan.toDownload, ...plan.toUpdate];
      task.pendingDeletes = [...plan.toDelete];
      task.totalFiles = task.pendingDownloads.length + task.pendingDeletes.length;

      // Nothing to do — short-circuit to up-to-date so renderer drops progress
      // UI immediately.
      if (task.totalFiles === 0) {
        await this.persistLocalManifest(active, clientFolder);
        this.emitStatus(slug, BundleSyncStatuses.UP_TO_DATE);
        this.resolveAwaiters(active);
        return;
      }

      const { deletedAny } = await runSyncPhases(task, emit);

      // Defensive heal — only fires when we actually removed files, since
      // additions/replacements can't reduce vanilla coverage.
      if (deletedAny) {
        this.emitStatus(slug, BundleSyncStatuses.HEALING);
        await this.healer.healAfterDeletes(slug, plan.bundleOwnedRelativePaths, {
          signal: abort.signal,
          onEvent: createHealProgressListener(slug, emit),
        });
      }

      await this.persistLocalManifest(active, clientFolder);
      this.emitStatus(slug, BundleSyncStatuses.COMPLETED);
      this.resolveAwaiters(active);
    } catch (err) {
      const code = classifyBundleError(err, abort.signal);
      if (code === BundleErrorCodes.ABORTED && task.cancelled) {
        this.emitStatus(slug, BundleSyncStatuses.CANCELLED);
        this.rejectAwaiters(active, this.toError(err));
        return;
      }
      if (code === BundleErrorCodes.ABORTED && task.paused) {
        // Paused mid-flight; status already emitted by pauseSync. Don't
        // reject awaiters — they'll be resolved when resume completes.
        return;
      }
      this.emitError(slug, code, errorMessage(err));
      this.emitStatus(slug, BundleSyncStatuses.ERROR);
      this.rejectAwaiters(active, this.toError(err));
    } finally {
      if (!task.paused || task.cancelled) {
        this.activeSyncs.delete(slug);
      }
    }
  }

  private async continuePausedSync(active: ActiveSync): Promise<void> {
    const { task } = active;
    // Re-plan from current disk state so files completed before pause are
    // skipped via the sha256 fast-path.
    task.paused = false;
    task.cancelled = false;
    task.abort = new AbortController();
    task.currentRequests = new Set<ClientRequest>();
    task.bytesDownloaded = 0;
    task.processedFiles = 0;
    task.lastEmittedAt = 0;
    task.speedWindowStart = Date.now();
    task.speedWindowBytes = 0;

    const emit: EmitProgress = createEmit(active, task, (event) => {
      this.broadcaster.progress(event);
    });

    try {
      this.emitStatus(task.slug, BundleSyncStatuses.PLANNING);
      const local = await loadLocalManifest(task.clientFolder);
      const plan = await buildPlan(active.remoteManifest, local, task.clientFolder, {
        force: false,
      });
      task.plan = plan;
      task.pendingDownloads = [...plan.toDownload, ...plan.toUpdate];
      task.pendingDeletes = [...plan.toDelete];
      task.totalFiles = task.pendingDownloads.length + task.pendingDeletes.length;

      if (task.totalFiles === 0) {
        await this.persistLocalManifest(active, task.clientFolder);
        this.emitStatus(task.slug, BundleSyncStatuses.UP_TO_DATE);
        this.resolveAwaiters(active);
        return;
      }

      const { deletedAny } = await runSyncPhases(task, emit);
      if (deletedAny) {
        this.emitStatus(task.slug, BundleSyncStatuses.HEALING);
        await this.healer.healAfterDeletes(task.slug, plan.bundleOwnedRelativePaths, {
          signal: task.abort.signal,
          onEvent: createHealProgressListener(task.slug, emit),
        });
      }
      await this.persistLocalManifest(active, task.clientFolder);
      this.emitStatus(task.slug, BundleSyncStatuses.COMPLETED);
      this.resolveAwaiters(active);
    } catch (err) {
      const code = classifyBundleError(err, task.abort.signal);
      if (code === BundleErrorCodes.ABORTED && task.cancelled) {
        this.emitStatus(task.slug, BundleSyncStatuses.CANCELLED);
        this.rejectAwaiters(active, this.toError(err));
        return;
      }
      if (code === BundleErrorCodes.ABORTED && task.paused) {
        return;
      }
      this.emitError(task.slug, code, errorMessage(err));
      this.emitStatus(task.slug, BundleSyncStatuses.ERROR);
      this.rejectAwaiters(active, this.toError(err));
    } finally {
      if (!task.paused || task.cancelled) {
        this.activeSyncs.delete(task.slug);
      }
    }
  }

  private async persistLocalManifest(active: ActiveSync, clientFolder: string): Promise<void> {
    const flat = flattenRemote(active.remoteManifest);
    const manifest: LocalManifest = {
      bundleSlug: active.bundleSlug,
      manifestHash: active.remoteManifestHash,
      syncedAt: new Date().toISOString(),
      files: flat.files,
    };
    try {
      await saveLocalManifest(clientFolder, manifest);
    } catch (err) {
      logger.warn(`[${active.task.slug}] failed to persist local bundle manifest`, err);
    }
  }

  private async tryGetClient(slug: ClientSlug) {
    try {
      return await getClient(slug);
    } catch {
      return null;
    }
  }

  private resolveClientFolder(slug: ClientSlug): string {
    const resolved = resolveClientSettings(getSettings(), slug);
    return resolved.storage.clientFolder || '';
  }

  private emitStatus(slug: ClientSlug, status: BundleSyncStatus): void {
    this.broadcaster.status({ slug, status });
  }

  private emitError(slug: ClientSlug, code: BundleErrorCode, message: string): void {
    this.broadcaster.error({ slug, code, message });
  }

  private resolveAwaiters(active: ActiveSync): void {
    const waiters = active.awaiters.splice(0, active.awaiters.length);
    for (const w of waiters) w.resolve();
  }

  private rejectAwaiters(active: ActiveSync, err: Error): void {
    const waiters = active.awaiters.splice(0, active.awaiters.length);
    for (const w of waiters) w.reject(err);
  }

  private armPauseIdleTimer(slug: ClientSlug, active: ActiveSync): void {
    this.clearPauseIdleTimer(active);
    const timer = setTimeout(() => {
      this.expirePausedSync(slug);
    }, BUNDLE_PAUSED_SYNC_MAX_IDLE_MS);
    // Allow the process to exit even if a paused sync is still parked.
    if (typeof timer.unref === 'function') timer.unref();
    active.pauseIdleTimer = timer;
  }

  private clearPauseIdleTimer(active: ActiveSync): void {
    if (active.pauseIdleTimer) {
      clearTimeout(active.pauseIdleTimer);
      active.pauseIdleTimer = null;
    }
  }

  private expirePausedSync(slug: ClientSlug): void {
    const active = this.activeSyncs.get(slug);
    if (!active || !active.task.paused) return;
    active.pauseIdleTimer = null;
    logger.info(`[${slug}] paused sync idle timeout reached — auto-cancelling`);
    this.emitStatus(slug, BundleSyncStatuses.CANCELLED);
    this.rejectAwaiters(
      active,
      new BundleError(BundleErrorCodes.ABORTED, 'Paused sync expired before resume'),
    );
    this.activeSyncs.delete(slug);
  }

  private toError(err: unknown): Error {
    if (err instanceof Error) return err;
    return new Error(String(err));
  }

  // Called on app shutdown to abort every active sync — cooperative pause/cancel
  // doesn't stop the underlying sockets unless the runner sees the abort, so we
  // also destroy current requests synchronously and wait a short grace window
  // so the runner's finally blocks (tmp cleanup, manifest writes) can land.
  async cancelAll(graceMs = 250): Promise<void> {
    const slugs = [...this.activeSyncs.keys()];
    for (const slug of slugs) this.cancelSync(slug);
    if (graceMs > 0 && slugs.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, graceMs));
    }
  }

  // Called by MinecraftManager.uninstall to wipe the local manifest sidecar
  // file when the client folder isn't fully removed.
  async resetForUninstall(slug: ClientSlug): Promise<void> {
    const clientFolder = this.resolveClientFolder(slug);
    if (!clientFolder) return;
    await clearLocalManifest(clientFolder);
  }
}

// Plan helpers — exported only for tests.
export const _internals = { flattenRemote };
export type { ActiveSync, SyncPlan };
