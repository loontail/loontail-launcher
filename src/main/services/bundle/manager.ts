import {
  BUNDLE_PAUSED_SYNC_MAX_IDLE_MS,
  MANIFEST_DRIFT_FETCH_TIMEOUT_MS,
  MANIFEST_DRIFT_TTL_MS,
} from '@main/constants/bundle';
import { errorMessage } from '@main/infra/errorMessage';
import {
  isCancelled,
  isPaused,
  isRunning,
  markCancelled,
  markPaused,
} from '@main/infra/lifecyclePhase';
import { scopedLogger } from '@main/infra/logger';
import {
  ClientOperationDomains,
  type ClientOperationLease,
  type ClientOperationLocks,
  ClientOperationResources,
} from '@main/services/clientOperationLocks';
import { getClient as defaultGetClient } from '@main/services/clients';
import { getSettings as defaultGetSettings } from '@main/services/settings/settings';
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
import { parseCatalogKey, SourceKinds } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import type { BundleSlug, CatalogKey, ClientSlug } from '@shared/contracts/ids';
import type { LauncherSettings } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import { fetchRemoteManifest } from './api';
import type { BundleBroadcaster } from './broadcast';
import { BundleError, classifyBundleError } from './errors';
import type { Healer } from './healer';
import { createHealProgressListener } from './healProgress';
import { loadLocalManifest, saveLocalManifest } from './manifestRepo';
import { flattenRemote } from './manifestSnapshot';
import { buildPlan } from './plan';
import { type EmitProgress, runSyncPhases, type SyncTask } from './runner';
import {
  type ActiveSync,
  createActiveSync,
  createSyncTask,
  resetTaskForResume,
  type SyncStateMap,
} from './syncState';

const logger = scopedLogger('bundle.manager');
const BUNDLE_WRITE_RESOURCES = [
  ClientOperationResources.CLIENT_FOLDER,
  ClientOperationResources.BUNDLE_MANIFEST,
] as const;

type PreparedPlanSource = {
  force: boolean;
};

// What a probe can conclude without a network error to report. Kept separate from
// SyncTargetResult so the getStatus path cannot be handed a 'fetch-failed' it has
// no way to act on — that branch used to exist and be dead by construction.
type SyncTargetProbe =
  | { kind: 'ok'; bundleSlug: BundleSlug; clientFolder: string }
  | { kind: 'no-client' }
  | { kind: 'no-bundle' }
  | { kind: 'no-folder' };

type SyncTargetResult =
  | SyncTargetProbe
  | { kind: 'fetch-failed'; slug: ClientSlug; cause: unknown };

export type GetClient = (slug: ClientSlug) => Promise<Client>;

export type GetSettings = () => LauncherSettings;

// getClient throws this exact message when the slug is absent from a fetched
// list; any other error means the fetch itself failed.
const isClientNotFound = (err: unknown, slug: ClientSlug): boolean =>
  err instanceof Error && err.message === `Client "${slug}" not found`;

const makeProgressEvent = (
  task: SyncTask,
  key: CatalogKey,
  status: BundleSyncStatus,
  patch?: Partial<BundleProgressEvent>,
): BundleProgressEvent => ({
  key,
  status,
  processedFiles: patch?.processedFiles ?? task.processedFiles,
  totalFiles: patch?.totalFiles ?? task.totalFiles,
  toDownload: patch?.toDownload ?? task.plan.toDownload.length + task.plan.toUpdate.length,
  toUpdate: patch?.toUpdate ?? task.plan.toUpdate.length,
  toDelete: patch?.toDelete ?? task.plan.toDelete.length,
  toSkip: patch?.toSkip ?? task.plan.toSkip.length,
  bytesDownloaded: patch?.bytesDownloaded ?? task.bytesDownloaded,
  bytesTotal: patch?.bytesTotal ?? task.plan.bytesTotal,
  ...(patch?.currentFile ? { currentFile: patch.currentFile } : {}),
});

const createEmit = (
  active: ActiveSync,
  task: SyncTask,
  emitProgress: (event: BundleProgressEvent) => void,
): EmitProgress => {
  return (key, status, patch) => {
    const event = makeProgressEvent(task, key, status, patch);
    active.lastProgress = event;
    emitProgress(event);
  };
};

export class BundleManager {
  // Short-lived cache of the remote manifest hash, read only by getStatus
  // to bound its per-IPC round-trip. The sync path always fetches fresh.
  private readonly manifestHashCache = new Map<BundleSlug, { hash: string; fetchedAt: number }>();

  constructor(
    private readonly broadcaster: BundleBroadcaster,
    private readonly healer: Healer,
    private readonly operationLocks: ClientOperationLocks,
    private readonly activeSyncs: SyncStateMap = new Map(),
    private readonly getClient: GetClient = defaultGetClient,
    // Injected like every other cross-domain edge (the module function is the
    // production default) so a test needs no store double.
    private readonly getSettings: GetSettings = defaultGetSettings,
  ) {}

  async start(req: BundleStartRequest): Promise<void> {
    await this.runSync(req, { forLaunch: false });
  }

  // Awaits the sync to a terminal status before launch; resolves immediately
  // when the client has no bundle. Errors propagate — the caller aborts launch
  // on failure.
  async syncForLaunch(key: CatalogKey, externalSignal?: AbortSignal): Promise<void> {
    if (externalSignal?.aborted) {
      throw new BundleError(BundleErrorCodes.ABORTED, 'Sync aborted before start');
    }
    const onExternalAbort = () => {
      this.cancel(key);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    try {
      await this.runSync({ key }, { forLaunch: true });
    } finally {
      // Detach before returning so a late abort cannot invoke cancel on an
      // already-dropped key.
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  pause(key: CatalogKey): void {
    const active = this.activeSyncs.get(key);
    if (!active) return;
    // Guard so the abort/emit/timer side effects below don't re-run on an
    // already-paused or terminal task.
    if (!isRunning(active.task)) return;
    markPaused(active.task);
    // Abort current downloads; the runner rethrows ABORTED and executePreparedSync
    // parks the partial state for resume.
    active.task.abort.abort();
    this.emitStatus(key, BundleSyncStatuses.PAUSED);
    this.armPauseIdleTimer(key, active);
  }

  async resume(key: CatalogKey): Promise<void> {
    const active = this.activeSyncs.get(key);
    if (!active) {
      // Nothing pending — start a fresh sync, awaited so a failure crosses IPC
      // as a rejection instead of being swallowed.
      await this.start({ key });
      return;
    }
    if (!isPaused(active.task)) return;
    this.clearPauseIdleTimer(active);
    // Fire-and-forget: the paused resume re-plans from disk and runs to its own
    // terminal status; the route returns once it has been kicked off.
    void this.continuePausedSync(active).catch((err) => {
      logger.warn(`[${key}] resume failed`, err);
    });
  }

  cancel(key: CatalogKey): void {
    const active = this.activeSyncs.get(key);
    if (!active) return;
    this.clearPauseIdleTimer(active);
    const wasPaused = isPaused(active.task);
    // Terminal: overrides a pause and cannot be revived.
    markCancelled(active.task);
    active.task.abort.abort();
    for (const req of active.task.currentRequests) {
      req.destroy();
    }
    active.task.currentRequests.clear();
    // A paused sync's execution path already exited, so its finally cleanup
    // won't run — do that cleanup here.
    if (wasPaused) {
      this.emitStatus(key, BundleSyncStatuses.CANCELLED);
      this.rejectAwaiters(
        active,
        new BundleError(BundleErrorCodes.ABORTED, 'Sync cancelled while paused'),
      );
      this.dropActiveSync(key);
    }
  }

  async getStatus(key: CatalogKey): Promise<BundleInstallState> {
    const active = this.activeSyncs.get(key);
    if (active) {
      return {
        installed: false,
        signatureMatches: true,
        progress: active.lastProgress,
      };
    }
    const target = await this.probeSyncTarget(key);
    if (target.kind === 'no-client' || target.kind === 'no-bundle') {
      return { installed: true, signatureMatches: true, progress: null };
    }
    if (target.kind === 'no-folder') {
      return { installed: false, signatureMatches: true, progress: null };
    }
    const { bundleSlug, clientFolder } = target;
    const local = await loadLocalManifest(clientFolder);
    if (!local) {
      return { installed: false, signatureMatches: false, progress: null };
    }
    // Best-effort drift check: a dead network returns signatureMatches=true so
    // the UI never gates on it, leaving the next sync to reconcile.
    const remoteHash = await this.remoteHashForDriftCheck(key, bundleSlug);
    if (remoteHash === null) {
      return { installed: true, signatureMatches: true, progress: null };
    }
    return { installed: true, signatureMatches: remoteHash === local.manifestHash, progress: null };
  }

  // Remote manifest hash for the drift check, reusing a cached value within
  // MANIFEST_DRIFT_TTL_MS. The fetch is bounded so a dead network degrades to
  // null (caller treats null as signatureMatches:true).
  private async remoteHashForDriftCheck(
    key: CatalogKey,
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
      logger.warn(`[${key}] getStatus: manifest fetch failed, assuming up-to-date`, err);
      return null;
    }
  }

  // Called on every real fetch so a sync primes the cache and the immediately
  // following status probe reuses it.
  private cacheRemoteHash(bundleSlug: BundleSlug, hash: string): void {
    this.manifestHashCache.set(bundleSlug, { hash, fetchedAt: Date.now() });
  }

  private async runSync(req: BundleStartRequest, options: { forLaunch: boolean }): Promise<void> {
    const { key } = req;
    // The write lock acquired below is the single source of truth for in-flight dedup.
    const target = await this.resolveSyncTarget(key);
    if (target.kind === 'no-client') {
      throw new BundleError(BundleErrorCodes.UNKNOWN, `Client "${key}" not found`);
    }
    if (target.kind === 'fetch-failed') {
      throw new BundleError(
        BundleErrorCodes.MANIFEST_FETCH_FAILED,
        `Failed to load client "${target.slug}": ${errorMessage(target.cause)}`,
      );
    }
    if (target.kind === 'no-bundle') {
      // No bundle attached — treat as a successful no-op so launch can proceed.
      this.emitStatus(key, BundleSyncStatuses.NO_BUNDLE);
      return;
    }
    if (target.kind === 'no-folder') {
      throw new BundleError(
        BundleErrorCodes.NO_CLIENT_FOLDER,
        'Set the launcher install folder in System settings first',
      );
    }
    const { bundleSlug, clientFolder } = target;
    const lock = this.acquireWriteLock(key);
    // dropActiveSync only releases the lease once an ActiveSync owns it, so
    // release here if construction throws before registration.
    let active: ActiveSync;
    try {
      const task = createSyncTask(key, clientFolder);
      active = createActiveSync(task, lock, bundleSlug, options.forLaunch);
      this.activeSyncs.set(key, active);
    } catch (err) {
      lock.release();
      throw err;
    }
    const task = active.task;
    const launchWait = active.forLaunch ? this.createAwaiter(active) : null;
    lock.setCancel(() => this.cancel(key));
    try {
      await this.executePreparedSync(active, task, { force: req.force === true });
      await launchWait;
    } catch (err) {
      this.dropActiveSync(key);
      throw err;
    }
  }

  private async continuePausedSync(active: ActiveSync): Promise<void> {
    const { task } = active;
    try {
      // Re-plan from disk so files completed before pause hit the sha256 skip.
      resetTaskForResume(task);

      await this.executePreparedSync(active, task, { force: false });
    } catch (err) {
      // executePreparedSync drops on its own exit paths; reaching here means
      // resume threw around it, so drop (idempotent) or the key stays wedged
      // with an undead lock.
      this.dropActiveSync(task.key);
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
      this.emitStatus(task.key, BundleSyncStatuses.PLANNING);
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
      if (isCancelled(task))
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
        this.emitStatus(task.key, BundleSyncStatuses.HEALING);
        const progress = createHealProgressListener(task.key, emit);
        try {
          await this.healer.healAfterDeletes(task.key, plan.bundleOwnedRelativePaths, {
            signal: task.abort.signal,
            onEvent: progress.onEvent,
          });
        } finally {
          progress.dispose();
        }
      }
      // A cancel/pause can land between heal resolving and settling COMPLETED
      // (heal returns rather than throwing if the abort fires as it finishes).
      // Re-check phase: cancel is terminal, so re-throw ABORTED to route through
      // the catch's CANCELLED branch; a pause parks the sync for resume.
      if (isCancelled(task)) {
        throw new BundleError(BundleErrorCodes.ABORTED, 'cancelled after heal');
      }
      if (isPaused(task)) {
        return;
      }
      await this.completePreparedSync(active, BundleSyncStatuses.COMPLETED);
    } catch (err) {
      // This catch only decodes the ABORTED the runner throws on a cancel
      // (terminal → emit CANCELLED) or a worker rejecting mid-pause (swallow,
      // leaving the parked sync for resume).
      const code = classifyBundleError(err, task.abort.signal);
      // Check cancel before pause: cancel is terminal and overrides a pause.
      if (code === BundleErrorCodes.ABORTED && isCancelled(task)) {
        this.emitStatus(task.key, BundleSyncStatuses.CANCELLED);
        this.rejectAwaiters(active, this.toBundleError(err, code));
        return;
      }
      if (code === BundleErrorCodes.ABORTED && isPaused(task)) {
        return;
      }
      logger.error(`[${task.key}] bundle sync failed (${code}) — ${errorMessage(err)}`, err);
      this.emitError(task.key, code, errorMessage(err));
      this.emitStatus(task.key, BundleSyncStatuses.ERROR);
      this.rejectAwaiters(active, this.toBundleError(err, code));
    } finally {
      // Keep registered only while parked for resume (paused); a cancelled task
      // is terminal and drops like a completed one.
      if (!isPaused(task)) {
        this.dropActiveSync(task.key);
      }
    }
  }

  // Fetches once, caching on the ActiveSync. The empty-hash sentinel makes a
  // resume after a pause-during-fetch refetch instead of planning against the
  // empty {} (which would mark the whole bundle for deletion).
  private async ensureRemoteManifest(active: ActiveSync): Promise<RemoteManifest> {
    if (active.remoteManifestHash !== '') {
      return active.remoteManifest;
    }
    this.emitStatus(active.task.key, BundleSyncStatuses.FETCHING_MANIFEST);
    const { manifest, manifestHash } = await fetchRemoteManifest(
      active.bundleSlug,
      active.task.abort.signal,
    );
    active.remoteManifest = manifest;
    active.remoteManifestHash = manifestHash;
    // Prime the drift-check cache so a status probe right after a sync skips its
    // own round-trip.
    this.cacheRemoteHash(active.bundleSlug, manifestHash);
    return manifest;
  }

  private async completePreparedSync(active: ActiveSync, status: BundleSyncStatus): Promise<void> {
    // Settle status + awaiters in finally so a trailing manifest-write failure
    // can't hang a finished sync and block the launch flow.
    try {
      await this.persistLocalManifest(active, active.task.clientFolder);
    } finally {
      this.emitStatus(active.task.key, status);
      this.resolveAwaiters(active);
    }
  }

  private async persistLocalManifest(active: ActiveSync, clientFolder: string): Promise<void> {
    // The empty-string sentinel means no manifest was fetched; persisting it
    // would write an empty signature the next drift check could never match.
    if (active.remoteManifestHash === '') {
      logger.warn(`[${active.task.key}] refusing to persist local manifest with empty remote hash`);
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
      logger.warn(`[${active.task.key}] failed to persist local bundle manifest`, err);
    }
  }

  // Bundles only exist on official builds, so recover the bare slug getClient
  // expects; a non-official key yields null → "no such client".
  private officialSlugFor(key: CatalogKey): ClientSlug | null {
    const ref = parseCatalogKey(key);
    return ref && ref.source === SourceKinds.OFFICIAL ? ref.slug : null;
  }

  private targetForClient(key: CatalogKey, client: Client): SyncTargetProbe {
    const bundleSlug = client.bundleSlug ?? null;
    if (!bundleSlug) return { kind: 'no-bundle' };
    const clientFolder = this.resolveClientFolder(key);
    if (!clientFolder) return { kind: 'no-folder' };
    return { kind: 'ok', bundleSlug, clientFolder };
  }

  // Probe for the getStatus path: a getClient failure collapses to no-client
  // because a status probe must never gate the UI on a network error.
  private async probeSyncTarget(key: CatalogKey): Promise<SyncTargetProbe> {
    const slug = this.officialSlugFor(key);
    if (!slug) return { kind: 'no-client' };
    try {
      return this.targetForClient(key, await this.getClient(slug));
    } catch {
      return { kind: 'no-client' };
    }
  }

  // Resolve client + bundle + install folder for a real sync, splitting a genuine
  // not-found from a fetch failure (→ MANIFEST_FETCH_FAILED) so the user sees
  // "backend unreachable" instead of an opaque UNKNOWN "client not found".
  private async resolveSyncTarget(key: CatalogKey): Promise<SyncTargetResult> {
    const slug = this.officialSlugFor(key);
    if (!slug) return { kind: 'no-client' };
    let client: Client;
    try {
      client = await this.getClient(slug);
    } catch (err) {
      if (isClientNotFound(err, slug)) return { kind: 'no-client' };
      return { kind: 'fetch-failed', slug, cause: err };
    }
    return this.targetForClient(key, client);
  }

  private resolveClientFolder(key: CatalogKey): string | null {
    const resolved = resolveClientSettings(this.getSettings(), key);
    return resolved.storage.clientFolder || null;
  }

  private acquireWriteLock(key: CatalogKey): ClientOperationLease {
    const result = this.operationLocks.acquire({
      key,
      domain: ClientOperationDomains.BUNDLE,
      resources: BUNDLE_WRITE_RESOURCES,
    });
    if (result.kind === 'acquired') return result.lease;
    throw new BundleError(
      BundleErrorCodes.OP_IN_FLIGHT,
      'Another operation is already running for this client',
    );
  }

  private dropActiveSync(key: CatalogKey): void {
    const active = this.activeSyncs.get(key);
    if (!active) return;
    this.activeSyncs.delete(key);
    active.lock.release();
    active.signalDropped();
  }

  private emitStatus(key: CatalogKey, status: BundleSyncStatus): void {
    this.broadcaster.status({ key, status });
  }

  private emitError(key: CatalogKey, code: BundleErrorCode, message: string): void {
    this.broadcaster.error({ key, code, message });
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

  private armPauseIdleTimer(key: CatalogKey, active: ActiveSync): void {
    this.clearPauseIdleTimer(active);
    const timer = setTimeout(() => {
      this.expirePausedSync(key);
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

  private expirePausedSync(key: CatalogKey): void {
    const active = this.activeSyncs.get(key);
    if (!active || !isPaused(active.task)) return;
    logger.info(`[${key}] paused sync idle timeout reached — auto-cancelling`);
    this.emitStatus(key, BundleSyncStatuses.CANCELLED);
    this.rejectAwaiters(
      active,
      new BundleError(BundleErrorCodes.ABORTED, 'Paused sync expired before resume'),
    );
    this.dropActiveSync(key);
  }

  private toBundleError(err: unknown, code: BundleErrorCode): BundleError {
    if (err instanceof BundleError) return err;
    return new BundleError(code, errorMessage(err));
  }

  // Destroy in-flight sockets, then await each sync's real completion bounded by
  // a timeout so a wedged sync can't block process exit.
  //
  // Durability invariant: on shutdown this is awaited for at most `maxMs`, then
  // the database is closed (index.ts). A sync's `finally` must therefore NOT do
  // store/DB writes — a slow write could be truncated or race the closing handle.
  // Durable state (the local manifest) is written on the success path, not in
  // teardown.
  async cancelAll(maxMs = 250): Promise<void> {
    const actives = [...this.activeSyncs.values()];
    const keys = actives.map((active) => active.task.key);
    for (const key of keys) this.cancel(key);
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
