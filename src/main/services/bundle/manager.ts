import {
  BUNDLE_PAUSED_SYNC_MAX_IDLE_MS,
  MANIFEST_DRIFT_FETCH_TIMEOUT_MS,
  MANIFEST_DRIFT_TTL_MS,
} from '@main/constants/bundle';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import {
  ClientOperationDomains,
  type ClientOperationLease,
  type ClientOperationLocks,
  ClientOperationResources,
} from '@main/services/clientOperationLocks';
import { getClient as defaultGetClient } from '@main/services/clients';
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
import { SourceKinds, parseCatalogKey } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import type { BundleSlug, CatalogKey, ClientSlug } from '@shared/contracts/ids';
import { resolveClientSettings } from '@shared/domain/settings';
import { fetchRemoteManifest } from './api';
import type { BundleBroadcaster } from './broadcast';
import { BundleError, classifyBundleError } from './errors';
import { createHealProgressListener } from './healProgress';
import type { Healer } from './healer';
import { loadLocalManifest, saveLocalManifest } from './manifestRepo';
import { flattenRemote } from './manifestSnapshot';
import { type SyncPlan, buildPlan } from './plan';
import { type EmitProgress, type SyncTask, runSyncPhases } from './runner';
import {
  type ActiveSync,
  SyncStateStore,
  createActiveSync,
  createSyncTask,
  resetTaskForResume,
} from './syncState';

const logger = scopedLogger('bundle.manager');
const BUNDLE_WRITE_RESOURCES = [
  ClientOperationResources.CLIENT_FOLDER,
  ClientOperationResources.BUNDLE_MANIFEST,
] as const;

type PreparedPlanSource = {
  force: boolean;
};

export type GetClient = (slug: ClientSlug) => Promise<Client>;

// getClient throws this exact message when the slug is absent from a
// successfully fetched list; any other error means the fetch itself failed.
const isClientNotFound = (err: unknown, slug: ClientSlug): boolean =>
  err instanceof Error && err.message === `Client "${slug}" not found`;

const makeProgressEvent = (
  task: SyncTask,
  slug: CatalogKey,
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
  // Short-lived cache of the REMOTE manifest hash, keyed by the bare BundleSlug.
  // Only getInstallState reads it (to bound its per-IPC network round-trip); the
  // local manifest is still read fresh and compared every call, and the sync
  // path never consults it (always fetches fresh).
  private readonly manifestHashCache = new Map<BundleSlug, { hash: string; fetchedAt: number }>();

  constructor(
    private readonly broadcaster: BundleBroadcaster,
    private readonly healer: Healer,
    private readonly operationLocks: ClientOperationLocks,
    private readonly activeSyncs: SyncStateStore = new SyncStateStore(),
    private readonly getClient: GetClient = defaultGetClient,
  ) {}

  async startSync(req: BundleStartRequest): Promise<void> {
    await this.runSync(req, { forLaunch: false });
  }

  // Awaits the sync to a terminal status before launch; resolves immediately
  // when the client has no bundle. Errors propagate — the caller aborts launch
  // on failure.
  async syncForLaunch(slug: CatalogKey, externalSignal?: AbortSignal): Promise<void> {
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
      // why: detach before returning so an abort that fires after the sync has
      // already reached its terminal status (dropActiveSync cleared the slug)
      // cannot invoke cancelSync on a stale, dropped slug. cancelSync is guarded
      // for a missing slug, so this ordering is defensive, not load-bearing — but
      // it keeps the cleanup window closed across refactors.
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  pauseSync(slug: CatalogKey): void {
    const active = this.activeSyncs.get(slug);
    if (!active) return;
    if (active.task.cancelled) return;
    // Idempotent: a second pause must not re-arm the idle timer (resetting the
    // expiry window) or re-emit PAUSED.
    if (active.task.paused) return;
    active.task.paused = true;
    // Abort current downloads — the runner rethrows ABORTED for the now-paused
    // task, which executePreparedSync's catch decodes (ABORTED + task.paused) by
    // returning without dropping the active sync, parking the partial state for resume.
    active.task.abort.abort();
    this.emitStatus(slug, BundleSyncStatuses.PAUSED);
    this.armPauseIdleTimer(slug, active);
  }

  async resumeSync(slug: CatalogKey): Promise<void> {
    const active = this.activeSyncs.get(slug);
    if (!active) {
      // Nothing pending — caller probably wants a fresh sync. Await it so a
      // failure (e.g. NO_CLIENT_FOLDER) crosses IPC as a rejection instead of
      // being swallowed.
      await this.startSync({ slug });
      return;
    }
    if (active.task.cancelled) return;
    if (!active.task.paused) return;
    this.clearPauseIdleTimer(active);
    // Re-plan from current disk state — if files were finished before pause,
    // they're now hash-matched and will be skipped. Fire-and-forget: the paused
    // resume runs to its own terminal status; the route returns once re-planning
    // has been kicked off.
    void this.continuePausedSync(active).catch((err) => {
      logger.warn(`[${slug}] resume failed`, err);
    });
  }

  cancelSync(slug: CatalogKey): void {
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

  async getInstallState(slug: CatalogKey): Promise<BundleInstallState> {
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
    // it out. The remote hash is cached for a short TTL to bound the per-IPC
    // round-trip; the local hash above is always read fresh.
    const remoteHash = await this.remoteHashForDriftCheck(slug, client.bundleSlug);
    if (remoteHash === null) {
      return { installed: true, signatureMatches: true, progress: null };
    }
    return { installed: true, signatureMatches: remoteHash === local.manifestHash, progress: null };
  }

  // Returns the remote manifest hash for getInstallState's drift check, reusing a
  // cached value within MANIFEST_DRIFT_TTL_MS. A fetch is bounded by
  // MANIFEST_DRIFT_FETCH_TIMEOUT_MS so a dead network degrades to null (caller
  // treats null as signatureMatches:true). Never caches the computed match.
  private async remoteHashForDriftCheck(
    slug: CatalogKey,
    bundleSlug: BundleSlug,
  ): Promise<string | null> {
    const cached = this.manifestHashCache.get(bundleSlug);
    if (cached && Date.now() - cached.fetchedAt < MANIFEST_DRIFT_TTL_MS) {
      return cached.hash;
    }
    try {
      const { manifestHash } = await fetchRemoteManifest(
        bundleSlug,
        AbortSignal.timeout(MANIFEST_DRIFT_FETCH_TIMEOUT_MS),
      );
      this.cacheRemoteHash(bundleSlug, manifestHash);
      return manifestHash;
    } catch (err) {
      logger.warn(`[${slug}] checkStatus: manifest fetch failed, assuming up-to-date`, err);
      return null;
    }
  }

  // Seeds/refreshes the remote-hash cache. Called on every real fetch — both the
  // getInstallState drift check and the sync path's manifest fetch — so a sync
  // primes the cache and the immediately following status probe reuses it.
  private cacheRemoteHash(bundleSlug: BundleSlug, hash: string): void {
    this.manifestHashCache.set(bundleSlug, { hash, fetchedAt: Date.now() });
  }

  private async runSync(req: BundleStartRequest, options: { forLaunch: boolean }): Promise<void> {
    const { slug } = req;
    // The write lock (acquireWriteLock below) is the single source of truth for
    // in-flight dedup — it throws OP_IN_FLIGHT when another sync holds the lease.
    // A fetch failure (CMS offline) surfaces as MANIFEST_FETCH_FAILED, not
    // the opaque UNKNOWN "client not found" path.
    const client = await this.fetchClient(slug);
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
    // If task/active-sync construction throws before the sync is registered,
    // release the lease here — dropActiveSync only runs once an ActiveSync owns
    // the lock.
    let active: ActiveSync;
    try {
      const task = createSyncTask(slug, clientFolder);
      active = createActiveSync(task, lock, bundleSlug, options.forLaunch);
      this.activeSyncs.set(slug, active);
    } catch (err) {
      lock.release();
      throw err;
    }
    const task = active.task;
    const launchWait = active.forLaunch ? this.createAwaiter(active) : null;
    lock.setCancel(() => this.cancelSync(slug));
    try {
      await this.executePreparedSync(active, task, { force: req.force === true });
      await launchWait;
    } catch (err) {
      this.dropActiveSync(slug);
      throw err;
    }
  }

  private async continuePausedSync(active: ActiveSync): Promise<void> {
    const { task } = active;
    try {
      // Re-plan from current disk state so files completed before pause are
      // skipped via the sha256 fast-path.
      resetTaskForResume(task);

      await this.executePreparedSync(active, task, { force: false });
    } catch (err) {
      // executePreparedSync drops the active sync on its own exit paths. Reaching
      // here means resume threw before/around it (and resumeSync swallows the
      // rejection), so drop it or the slug stays wedged with an undead lock for
      // the rest of the session. dropActiveSync is idempotent.
      this.dropActiveSync(task.slug);
      throw err;
    }
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
      const remoteManifest = await this.ensureRemoteManifest(active);
      this.emitStatus(task.slug, BundleSyncStatuses.PLANNING);
      const local = await loadLocalManifest(task.clientFolder);
      const plan = await buildPlan(remoteManifest, local, task.clientFolder, {
        force: planSource.force,
        signal: task.abort.signal,
      });
      task.plan = plan;
      task.pendingDownloads = [...plan.toDownload, ...plan.toUpdate];
      task.pendingDeletes = [...plan.toDelete];
      task.totalFiles = task.pendingDownloads.length + task.pendingDeletes.length;

      // why: a cancel landing after buildPlan resolves but before the empty-plan
      // shortcut must surface CANCELLED to forLaunch awaiters, not UP_TO_DATE.
      if (task.cancelled)
        throw new BundleError(BundleErrorCodes.ABORTED, 'cancelled during planning');

      if (task.totalFiles === 0) {
        await this.completePreparedSync(active, BundleSyncStatuses.UP_TO_DATE);
        return;
      }

      const result = await runSyncPhases(task, emit);
      if (result.outcome === 'paused') {
        return;
      }
      if (result.deletedAny) {
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
      // A pause can still land mid-heal; the heal call observes task.abort but
      // returns rather than throwing, so re-check before settling COMPLETED.
      if (task.paused) {
        return;
      }
      await this.completePreparedSync(active, BundleSyncStatuses.COMPLETED);
    } catch (err) {
      // The resolved path discriminates pause/complete via runSyncPhases' outcome;
      // this catch only decodes the ABORTED that the runner still throws when a
      // cancel lands (terminal → emit CANCELLED) or a worker rejects mid-pause
      // (cooperative stop → swallow, leaving the parked sync for resume).
      const code = classifyBundleError(err, task.abort.signal);
      if (code === BundleErrorCodes.ABORTED && task.cancelled) {
        this.emitStatus(task.slug, BundleSyncStatuses.CANCELLED);
        this.rejectAwaiters(active, this.toBundleError(err, code));
        return;
      }
      if (code === BundleErrorCodes.ABORTED && task.paused) {
        return;
      }
      logger.error(`[${task.slug}] bundle sync failed (${code}) — ${errorMessage(err)}`, err);
      this.emitError(task.slug, code, errorMessage(err));
      this.emitStatus(task.slug, BundleSyncStatuses.ERROR);
      this.rejectAwaiters(active, this.toBundleError(err, code));
    } finally {
      if (!task.paused || task.cancelled) {
        this.dropActiveSync(task.slug);
      }
    }
  }

  // Fetches the remote manifest the first time (empty hash sentinel), caching it
  // on the ActiveSync; a resume after a pause-during-fetch sees the empty hash
  // and refetches instead of planning against the empty {} (which would mark the
  // whole bundle for deletion). FETCHING_MANIFEST is emitted only on a real fetch.
  private async ensureRemoteManifest(active: ActiveSync): Promise<RemoteManifest> {
    if (active.remoteManifestHash !== '') {
      return active.remoteManifest;
    }
    this.emitStatus(active.task.slug, BundleSyncStatuses.FETCHING_MANIFEST);
    const { manifest, manifestHash } = await fetchRemoteManifest(
      active.bundleSlug,
      active.task.abort.signal,
    );
    active.remoteManifest = manifest;
    active.remoteManifestHash = manifestHash;
    // Prime the drift-check cache so a status probe right after a sync skips its
    // own network round-trip. Seed only — the sync path never reads this cache.
    this.cacheRemoteHash(active.bundleSlug, manifestHash);
    return manifest;
  }

  private async completePreparedSync(active: ActiveSync, status: BundleSyncStatus): Promise<void> {
    // A trailing manifest-write failure must never demote a finished sync to a
    // hung state: settle the status and any forLaunch awaiter in finally so the
    // launch flow can proceed even if persistLocalManifest regresses to throw.
    try {
      await this.persistLocalManifest(active, active.task.clientFolder);
    } finally {
      this.emitStatus(active.task.slug, status);
      this.resolveAwaiters(active);
    }
  }

  private async persistLocalManifest(active: ActiveSync, clientFolder: string): Promise<void> {
    // The empty-string hash sentinel means no real manifest was ever fetched; a
    // real hash is 64-char hex. Writing it would persist a manifest with an empty
    // signature that the next drift check could never match.
    if (active.remoteManifestHash === '') {
      logger.warn(
        `[${active.task.slug}] refusing to persist local manifest with empty remote hash`,
      );
      return;
    }
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

  // Bundles only exist on official builds, so the CatalogKey reaching the sync
  // path is always `official:<slug>`; recover the bare slug that getClient
  // expects. A non-official key (defensive) yields null → "no such client".
  private officialSlugFor(key: CatalogKey): ClientSlug | null {
    const ref = parseCatalogKey(key);
    return ref && ref.source === SourceKinds.OFFICIAL ? ref.slug : null;
  }

  // getInstallState's best-effort probe — a fetch failure must not gate the UI,
  // so any error collapses to null (treated as "no client record").
  private async tryGetClient(key: CatalogKey) {
    const slug = this.officialSlugFor(key);
    if (!slug) return null;
    try {
      return await this.getClient(slug);
    } catch {
      return null;
    }
  }

  // Sync path: distinguish a genuine "no such client" (null) from a fetch
  // failure (network/CMS down) so the renderer sees MANIFEST_FETCH_FAILED
  // rather than an undifferentiated UNKNOWN.
  private async fetchClient(key: CatalogKey) {
    const slug = this.officialSlugFor(key);
    if (!slug) return null;
    try {
      return await this.getClient(slug);
    } catch (err) {
      if (isClientNotFound(err, slug)) return null;
      throw new BundleError(
        BundleErrorCodes.MANIFEST_FETCH_FAILED,
        `Failed to load client "${slug}": ${errorMessage(err)}`,
      );
    }
  }

  private resolveClientFolder(slug: CatalogKey): string | null {
    const resolved = resolveClientSettings(getSettings(), slug);
    return resolved.storage.clientFolder || null;
  }

  private acquireWriteLock(slug: CatalogKey): ClientOperationLease {
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

  private dropActiveSync(slug: CatalogKey): void {
    const active = this.activeSyncs.get(slug);
    if (!active) return;
    this.activeSyncs.delete(slug);
    active.lock.release();
    active.signalDropped();
  }

  private emitStatus(slug: CatalogKey, status: BundleSyncStatus): void {
    this.broadcaster.status({ slug, status });
  }

  private emitError(slug: CatalogKey, code: BundleErrorCode, message: string): void {
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

  private armPauseIdleTimer(slug: CatalogKey, active: ActiveSync): void {
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

  private expirePausedSync(slug: CatalogKey): void {
    const active = this.activeSyncs.get(slug);
    if (!active || !active.task.paused) return;
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

  // Cooperative pause/cancel doesn't stop in-flight sockets; destroy them
  // directly, then await each sync's real completion (its finally block running
  // tmp cleanup + manifest writes) rather than a fixed grace timer. A timeout
  // bounds the wait so a wedged sync can't block process exit indefinitely.
  async cancelAll(maxMs = 250): Promise<void> {
    const actives = [...this.activeSyncs.values()];
    const slugs = actives.map((active) => active.task.slug);
    for (const slug of slugs) this.cancelSync(slug);
    const pending = [...this.activeSyncs.values()].map((active) => active.whenDropped);
    if (pending.length === 0) return;
    const settled = Promise.allSettled(pending);
    if (maxMs <= 0) {
      await settled;
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
    await Promise.race([settled, timeout]);
    if (timer) clearTimeout(timer);
  }
}

// Plan helpers — exported only for tests.
export const _internals = { flattenRemote };
export type { ActiveSync, SyncPlan };
