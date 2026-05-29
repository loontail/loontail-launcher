import { BUNDLE_PAUSED_SYNC_MAX_IDLE_MS } from '@main/constants/bundle';
import { scopedLogger } from '@main/infra/logger';
import {
  ClientOperationDomains,
  type ClientOperationLease,
  type ClientOperationLocks,
  ClientOperationResources,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
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
import { createHealProgressListener } from './healProgress';
import type { Healer } from './healer';
import { clearLocalManifest, loadLocalManifest, saveLocalManifest } from './manifestRepo';
import { flattenRemote } from './manifestSnapshot';
import { type SyncPlan, buildPlan } from './plan';
import { type EmitProgress, type SyncTask, runSyncPhases } from './runner';
import { type ActiveSync, createActiveSync, createSyncTask, resetTaskForResume } from './syncState';

const logger = scopedLogger('bundle.manager');
const BUNDLE_WRITE_RESOURCES = [
  ClientOperationResources.CLIENT_FOLDER,
  ClientOperationResources.BUNDLE_MANIFEST,
] as const;

type PreparedPlanSource = {
  force: boolean;
  loadRemoteManifest: () => RemoteManifest | Promise<RemoteManifest>;
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
  private readonly activeLocks = new Map<ClientSlug, ClientOperationLease>();

  constructor(
    private readonly broadcaster: BundleBroadcaster,
    private readonly healer: Healer,
    private readonly operationLocks: ClientOperationLocks = createClientOperationLocks(),
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
    // If the sync was paused, the execution path has already exited and won't
    // run its finally cleanup again.
    if (wasPaused) {
      this.emitStatus(slug, BundleSyncStatuses.CANCELLED);
      this.rejectAwaiters(
        active,
        new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled while paused'),
      );
      this.dropActiveSync(slug);
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
    const lock = this.acquireWriteLock(slug);
    const task = createSyncTask(slug, clientFolder);
    const active = createActiveSync(task, bundleSlug, options.forLaunch);
    const launchWait = active.forLaunch ? this.createAwaiter(active) : null;
    this.activeSyncs.set(slug, active);
    this.activeLocks.set(slug, lock);
    lock.setCancel(() => this.cancelSync(slug));

    await this.executePreparedSync(active, task, {
      force: req.force === true,
      loadRemoteManifest: async () => {
        this.emitStatus(slug, BundleSyncStatuses.FETCHING_MANIFEST);
        const { manifest, manifestHash } = await fetchRemoteManifest(bundleSlug, task.abort.signal);
        active.remoteManifest = manifest;
        active.remoteManifestHash = manifestHash;
        return manifest;
      },
    });
    await launchWait;
  }

  private async continuePausedSync(active: ActiveSync): Promise<void> {
    const { task } = active;
    // Re-plan from current disk state so files completed before pause are
    // skipped via the sha256 fast-path.
    resetTaskForResume(task);

    await this.executePreparedSync(active, task, {
      force: false,
      loadRemoteManifest: () => active.remoteManifest,
    });
  }

  private async executePreparedSync(
    active: ActiveSync,
    task: SyncTask,
    planSource: PreparedPlanSource,
  ): Promise<void> {
    const emit: EmitProgress = createEmit(active, task, (event) => {
      this.broadcaster.progress(event);
    });

    try {
      const remoteManifest = await planSource.loadRemoteManifest();
      this.emitStatus(task.slug, BundleSyncStatuses.PLANNING);
      const local = await loadLocalManifest(task.clientFolder);
      const plan = await buildPlan(remoteManifest, local, task.clientFolder, {
        force: planSource.force,
      });
      task.plan = plan;
      task.pendingDownloads = [...plan.toDownload, ...plan.toUpdate];
      task.pendingDeletes = [...plan.toDelete];
      task.totalFiles = task.pendingDownloads.length + task.pendingDeletes.length;

      if (task.totalFiles === 0) {
        await this.completePreparedSync(active, BundleSyncStatuses.UP_TO_DATE);
        return;
      }

      const { deletedAny } = await runSyncPhases(task, emit);
      if (task.paused) {
        return;
      }
      if (deletedAny) {
        this.emitStatus(task.slug, BundleSyncStatuses.HEALING);
        const progress = createHealProgressListener(task.slug, emit);
        try {
          await this.healer.healAfterDeletes(task.slug, plan.bundleOwnedRelativePaths, {
            signal: task.abort.signal,
            onEvent: progress.onEvent,
          });
        } finally {
          progress.dispose();
        }
      }
      if (task.paused) {
        return;
      }
      await this.completePreparedSync(active, BundleSyncStatuses.COMPLETED);
    } catch (err) {
      const code = classifyBundleError(err, task.abort.signal);
      if (code === BundleErrorCodes.ABORTED && task.cancelled) {
        this.emitStatus(task.slug, BundleSyncStatuses.CANCELLED);
        this.rejectAwaiters(active, this.toBundleError(err, code));
        return;
      }
      if (code === BundleErrorCodes.ABORTED && task.paused) {
        return;
      }
      this.emitError(task.slug, code, errorMessage(err));
      this.emitStatus(task.slug, BundleSyncStatuses.ERROR);
      this.rejectAwaiters(active, this.toBundleError(err, code));
    } finally {
      if (!task.paused || task.cancelled) {
        this.dropActiveSync(task.slug);
      }
    }
  }

  private async completePreparedSync(active: ActiveSync, status: BundleSyncStatus): Promise<void> {
    await this.persistLocalManifest(active, active.task.clientFolder);
    this.emitStatus(active.task.slug, status);
    this.resolveAwaiters(active);
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

  private acquireWriteLock(slug: ClientSlug): ClientOperationLease {
    const result = this.operationLocks.acquire({
      slug,
      domain: ClientOperationDomains.BUNDLE,
      resources: BUNDLE_WRITE_RESOURCES,
    });
    if (result.kind === 'acquired') return result.lease;
    throw new BundleError(
      BundleErrorCodes.OP_IN_FLIGHT,
      'Another operation is already running for this client',
    );
  }

  private dropActiveSync(slug: ClientSlug): void {
    this.activeSyncs.delete(slug);
    const lock = this.activeLocks.get(slug);
    if (lock === undefined) return;
    lock.release();
    this.activeLocks.delete(slug);
  }

  private emitStatus(slug: ClientSlug, status: BundleSyncStatus): void {
    this.broadcaster.status({ slug, status });
  }

  private emitError(slug: ClientSlug, code: BundleErrorCode, message: string): void {
    this.broadcaster.error({ slug, code, message });
  }

  private createAwaiter(active: ActiveSync): Promise<void> {
    return new Promise((resolve, reject) => {
      active.awaiters.push({ resolve, reject });
    });
  }

  private resolveAwaiters(active: ActiveSync): void {
    const waiters = active.awaiters.splice(0, active.awaiters.length);
    for (const waiter of waiters) waiter.resolve();
  }

  private rejectAwaiters(active: ActiveSync, err: Error): void {
    const waiters = active.awaiters.splice(0, active.awaiters.length);
    for (const waiter of waiters) waiter.reject(err);
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
    this.dropActiveSync(slug);
  }

  private toBundleError(err: unknown, code: BundleErrorCode): BundleError {
    if (err instanceof BundleError) return err;
    return new BundleError(code, errorMessage(err));
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
