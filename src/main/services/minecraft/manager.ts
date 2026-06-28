import {
  type MinecraftKit,
  type RepairIssueFilter,
  type Target,
  assertNever,
} from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import {
  ClientOperationDomains,
  type ClientOperationLease,
  type ClientOperationLocks,
  type ClientOperationResource,
  ClientOperationResources,
} from '@main/services/clientOperationLocks';
import {
  getSettings,
  setClientOverride as persistClientOverride,
} from '@main/services/settings/settings';
import type { Account } from '@shared/contracts/account';
import type { CatalogItem } from '@shared/contracts/catalog';
import { SourceKinds } from '@shared/contracts/catalog';
import type { CatalogKey } from '@shared/contracts/ids';
import {
  type InstallStatus,
  InstallStatuses,
  MinecraftErrorCodes,
  type MinecraftStatusEvent,
} from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import type { Broadcaster } from './broadcast';
import { type Context, buildContext } from './context';
import type { ConsolePort, ManagerEnv } from './env';
import { ManagerError } from './errors';
import { createForgeProcessorCache } from './forgeProcessorHealing';
import { beginInstall, runInstall } from './install';
import { requireAccount, runLaunch } from './launch';
import { OP_TO_STATUS, type Op, OpKinds, OpRegistry, type RepairOp } from './ops';
import { resolveClientInstallPresence } from './readinessPolicy';
import { runRepair } from './repair';
import { runUninstall } from './uninstall';

const logger = scopedLogger('minecraft');
const MINECRAFT_WRITE_RESOURCES = [
  ClientOperationResources.CLIENT_FOLDER,
  ClientOperationResources.RUNTIME_COMPONENT,
] as const;
const MINECRAFT_DELETE_RESOURCES = [
  ClientOperationResources.CLIENT_FOLDER,
  ClientOperationResources.RUNTIME_COMPONENT,
  ClientOperationResources.BUNDLE_MANIFEST,
] as const;

// Optional hook the bundle service installs at boot; awaited in startLaunch's
// bundle-sync phase so a play click syncs the bundle before the game process is
// spawned. Untouched when no bundle is wired.
export type LaunchHook = (key: CatalogKey, signal?: AbortSignal) => Promise<void>;

// Synchronous "what's the active account" probe, injected at construction so
// the manager owns account resolution and the launch route stays a thin arg
// parser. Returns null when signed out — startLaunch turns that into NO_ACCOUNT.
export type AccountProvider = () => Account | null;

// Resolves a kit RepairIssueFilter from the on-disk bundle ownership, injected
// at the composition root from the bundle service so the minecraft repair path
// stays free of any static bundle import.
export type ResolveBundleRepairFilter = (
  clientFolder: string,
  expectedBundleSlug: string,
) => Promise<RepairIssueFilter | null>;

// Resolves a build from its CatalogKey, injected at the composition root from
// the catalog service so the manager owns no static catalog import.
export type ResolveBuild = (key: CatalogKey) => Promise<CatalogItem | null>;

export class MinecraftManager {
  private readonly ops: OpRegistry;
  private readonly env: ManagerEnv;
  private readonly kit: MinecraftKit;
  private launchHook: LaunchHook | null = null;

  constructor(
    broadcaster: Broadcaster,
    kit: MinecraftKit,
    private readonly operationLocks: ClientOperationLocks,
    console: ConsolePort,
    openConsole: () => void,
    private readonly accountProvider: AccountProvider,
    resolveBundleRepairFilter: ResolveBundleRepairFilter,
    private readonly resolveBuild: ResolveBuild,
    ops: OpRegistry = new OpRegistry(),
  ) {
    this.ops = ops;
    this.kit = kit;
    this.env = {
      kit,
      broadcaster,
      // env.ops must alias the registry's backing Map: the consumer modules
      // mutate ops through this reference and the manager reads them back.
      ops: ops.map,
      forgeProcessorCache: createForgeProcessorCache(),
      console,
      openConsole,
      logger,
      emitStatus: (payload: MinecraftStatusEvent) => broadcaster.status(payload),
      emitError: (slug, code, message) => broadcaster.error({ slug, code, message }),
      persistRuntime: (slug, runtime) => {
        try {
          persistClientOverride(slug, runtime === undefined ? { runtime: undefined } : { runtime });
        } catch (error) {
          logger.warn(`[${slug}] install: failed to persist runtime override`, error);
        }
      },
      clearRuntimeOverride: (slug) => {
        persistClientOverride(slug, { runtime: undefined });
      },
      resolveBundleRepairFilter,
    };
  }

  // Single buildContext entry point: threads the injected resolveBuild into the
  // context builder so the manager owns no static catalog dependency.
  private buildContext(slug: CatalogKey, loaderOverride?: LoaderChoice): Promise<Context> {
    return buildContext(this.kit, slug, loaderOverride, { resolveBuild: this.resolveBuild });
  }

  // Heal port consumed by the bundle service (injected at the composition root):
  // resolve the minecraft target + client folder for a slug so the post-delete
  // heal can verify/repair without the bundle service importing minecraft.
  async resolveHealTarget(slug: CatalogKey): Promise<{ target: Target; clientFolder: string }> {
    const ctx = await this.buildContext(slug);
    return { target: ctx.target, clientFolder: ctx.clientFolder };
  }

  // Set at most once in production; multiple sets are allowed only in tests.
  attachLaunchHook(hook: LaunchHook): void {
    this.launchHook = hook;
  }

  // The bundle launch hook runs only for official builds; LOCAL builds load
  // loose mods natively and have no managed overlay (the hook would fail trying
  // to resolve them as an official client). Returns the hook when eligible.
  private bundleHookFor(ctx: Context): LaunchHook | null {
    if (this.launchHook === null || ctx.item.kind === SourceKinds.LOCAL) return null;
    return this.launchHook;
  }

  async getStatus(slug: CatalogKey): Promise<{ status: InstallStatus; paused: boolean }> {
    const op = this.ops.get(slug);
    if (op) {
      return {
        status: OP_TO_STATUS[op.kind],
        paused: op.kind === OpKinds.INSTALL ? op.paused : false,
      };
    }
    // Opening the launcher must not verify the install (no hashing, no network,
    // no target resolve): report installability from local files only. The real
    // check runs when the user clicks Play.
    return {
      status: await resolveClientInstallPresence(slug),
      paused: false,
    };
  }

  async startInstall(slug: CatalogKey, loaderOverride?: LoaderChoice): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
    // Claim the slug before the buildContext await (mirror startRepair) so
    // getStatus reports INSTALLING during setup and a concurrent startLaunch
    // trips requireIdle instead of racing ops.set. A Stop in this window aborts
    // the placeholder controller, which beginInstall carries forward.
    const startingOp: Op = { kind: OpKinds.INSTALL_STARTING, abort: new AbortController() };
    this.ops.set(slug, startingOp);
    lock.setCancel(() => this.cancel(slug));
    this.env.emitStatus({ slug, status: InstallStatuses.INSTALLING, paused: false });
    let ctx: Context;
    try {
      ctx = await this.buildContext(slug, loaderOverride);
    } catch (error) {
      this.ops.delete(slug);
      lock.release();
      throw error;
    }
    if (startingOp.abort.signal.aborted) {
      this.ops.delete(slug);
      lock.release();
      this.env.emitStatus({
        slug,
        status: await resolveClientInstallPresence(slug),
        paused: false,
      });
      return;
    }
    const op = beginInstall(this.env, slug, ctx, { abort: startingOp.abort });
    void (async () => {
      try {
        await runInstall(this.env, slug, ctx, op);
      } finally {
        // Release before the bundle phase: the bundle sync acquires the same
        // CLIENT_FOLDER lease, so holding it here would self-block with
        // OP_IN_FLIGHT.
        lock.release();
      }
      // INSTALLED is emitted before the bundle phase so the UI can swap the
      // progress card from Minecraft download to bundle sync (which only renders
      // on top of an installed client).
      this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
      // Local builds carry no managed bundle overlay (loose mods load natively),
      // so the bundle launch hook is skipped (see bundleHookFor). Official
      // builds always run it (it no-ops internally when there is no bundleSlug).
      const installHook = this.bundleHookFor(ctx);
      if (installHook) {
        // Register a BUNDLE_SYNCING op for the duration of the sync (symmetric
        // with startLaunch's official path) so getStatus reports the sync,
        // cancel(slug) can abort the download, and cancelAll reaches it on quit.
        const bundleOp: Op = { kind: OpKinds.BUNDLE_SYNCING, abort: new AbortController() };
        this.ops.set(slug, bundleOp);
        try {
          await installHook(slug, bundleOp.abort.signal);
        } catch (error) {
          // On abort the op is being dropped below and getStatus falls back to
          // presence (INSTALLED), so the cancel is not an error. Other bundle
          // failures surface via the bundle.error channel; the Minecraft install
          // itself is done, so we keep the INSTALLED state either way.
          if (!bundleOp.abort.signal.aborted) {
            logger.warn(`[${slug}] install: bundle sync after install failed`, error);
          }
        } finally {
          this.ops.delete(slug);
        }
      }
    })().catch(() => {
      // runInstall failure already reported by handleInstallFailure; nothing to do.
    });
  }

  pause(slug: CatalogKey): void {
    const op = this.ops.get(slug);
    if (op?.kind !== OpKinds.INSTALL) return;
    op.paused = true;
    op.pauseController.pause();
    this.env.emitStatus({ slug, status: InstallStatuses.INSTALLING, paused: true });
  }

  resume(slug: CatalogKey): void {
    const op = this.ops.get(slug);
    if (op?.kind !== OpKinds.INSTALL) return;
    op.paused = false;
    op.pauseController.resume();
    this.env.emitStatus({ slug, status: InstallStatuses.INSTALLING, paused: false });
  }

  cancel(slug: CatalogKey): void {
    const op = this.ops.get(slug);
    if (!op) return;
    switch (op.kind) {
      case OpKinds.INSTALL:
        op.cancelled = true;
        op.pauseController.resume();
        op.abort.abort();
        return;
      case OpKinds.INSTALL_STARTING:
      case OpKinds.REPAIR:
      case OpKinds.BUNDLE_SYNCING:
      case OpKinds.LAUNCH_STARTING:
        op.abort.abort();
        return;
      case OpKinds.UNINSTALL:
        // Uninstall is an atomic file removal with no abort controller, so there
        // is nothing to interrupt. Warn so a Stop click during uninstall is
        // traceable instead of vanishing as a silent no-op.
        logger.warn(`[${slug}] cancel ignored: uninstall is not cancellable`);
        return;
      case OpKinds.LAUNCH:
        // The spawned game session is owned by the kit; it is torn down via
        // `stop()` (user-stop), never aborted here.
        return;
      default:
        assertNever(op);
    }
  }

  async startRepair(slug: CatalogKey): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
    // Register the op before the buildContext await so getStatus reports
    // REPAIRING (not the stale disk-presence status) during setup, and a second
    // concurrent startRepair trips requireIdle instead of starting in parallel.
    const op: Op = { kind: OpKinds.REPAIR, abort: new AbortController() };
    this.ops.set(slug, op);
    lock.setCancel(() => this.cancel(slug));
    this.env.emitStatus({ slug, status: InstallStatuses.REPAIRING, paused: false });
    let ctx: Context;
    try {
      // No "is it installed enough" gate: buildContext already enforces a
      // configured install folder (NO_CLIENT_FOLDER) and resolves the target, and
      // kit.repair.all rebuilds whatever is missing on disk — including the version
      // JSON — so repair runs from any state (a broken or even empty folder).
      ctx = await this.buildContext(slug);
    } catch (error) {
      this.ops.delete(slug);
      lock.release();
      throw error;
    }

    void this.finishRepair(slug, ctx, op, lock).catch((error) => {
      logger.error(`[${slug}] repair: unexpected background failure`, error);
    });
  }

  async uninstall(slug: CatalogKey): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug, MINECRAFT_DELETE_RESOURCES);
    const resolved = resolveClientSettings(getSettings(), slug);
    try {
      await runUninstall(
        this.env,
        slug,
        resolved.storage.clientFolder,
        resolved.storage.clientsFolder,
      );
    } finally {
      lock.release();
    }
  }

  async startLaunch(slug: CatalogKey): Promise<void> {
    this.requireIdle(slug);
    // Claim the slug synchronously (no await between the check and the claim) so
    // a second concurrent startLaunch trips requireIdle instead of both passing
    // the gate during buildContext and spawning two sessions for one client.
    // Setup failures release the claim; the paths below replace it with their
    // own op (bundle sync, then the launch op inside runLaunch).
    const startingOp: Op = { kind: OpKinds.LAUNCH_STARTING, abort: new AbortController() };
    this.ops.set(slug, startingOp);

    let ctx: Context;
    let checkedAccount: Account;
    try {
      ctx = await this.buildContext(slug);
      checkedAccount = requireAccount(this.accountProvider());
    } catch (error) {
      if (this.ops.get(slug) === startingOp) this.ops.delete(slug);
      throw error;
    }

    // A Stop issued during the buildContext window aborts startingOp but, since
    // buildContext resolved instead of throwing, the catch above never runs.
    // Honor the cancel here (for BOTH the local and official branches) before
    // spawning anything: drop the op and settle to presence/INSTALLED.
    if (startingOp.abort.signal.aborted) {
      if (this.ops.get(slug) === startingOp) this.ops.delete(slug);
      this.env.emitStatus({
        slug,
        status: await resolveClientInstallPresence(slug),
        paused: false,
      });
      return;
    }

    // BundleSyncingOp ensures cancel(slug) can abort the download mid-flight.
    // Local builds skip the sync phase and launch directly (see bundleHookFor).
    const launchHook = this.bundleHookFor(ctx);
    if (launchHook) {
      const bundleOp: Op = { kind: OpKinds.BUNDLE_SYNCING, abort: new AbortController() };
      this.ops.set(slug, bundleOp);
      this.env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
      try {
        await launchHook(slug, bundleOp.abort.signal);
      } catch (error) {
        if (bundleOp.abort.signal.aborted) {
          this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
          return;
        }
        logger.error(`[${slug}] launch: bundle sync failed`, error);
        // A non-aborted bundle failure (offline, manifest fetch error) must not
        // freeze the client on LAUNCHING — the base game is still installed and
        // launchable. Settle status back to INSTALLED and return without
        // rethrowing: the bundle error already reached the renderer via the
        // bundle error channel (BundleEventsListener toasts the localized code),
        // so propagating it would double-surface as the launch IPC rejection's
        // global toast (mirror runLaunch's swallow at launch.ts:445-447).
        this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
        return;
      } finally {
        this.ops.delete(slug);
      }
    }

    await runLaunch(this.env, slug, ctx, checkedAccount);
  }

  stop(slug: CatalogKey): void {
    const op = this.ops.get(slug);
    if (op?.kind === OpKinds.LAUNCH) op.session.abort('user-stop');
  }

  // Called on app shutdown so abortable ops are told to stop before the process
  // exits — including an in-flight bundle sync, whose open socket would
  // otherwise block Electron's quit until the request times out.
  cancelAll(): void {
    const slugs = [...this.ops.keys()];
    for (const slug of slugs) {
      const op = this.ops.get(slug);
      if (!op) continue;
      switch (op.kind) {
        case OpKinds.INSTALL_STARTING:
        case OpKinds.INSTALL:
        case OpKinds.REPAIR:
        case OpKinds.BUNDLE_SYNCING:
        case OpKinds.LAUNCH_STARTING:
          this.cancel(slug);
          break;
        case OpKinds.UNINSTALL:
        case OpKinds.LAUNCH:
          // UNINSTALL is uninterruptible; LAUNCH is the user's live game session
          // (kit-owned) — neither is aborted on shutdown.
          break;
        default:
          assertNever(op);
      }
    }
  }

  private requireIdle(slug: CatalogKey): void {
    if (this.ops.has(slug)) {
      throw new ManagerError(
        MinecraftErrorCodes.OP_IN_FLIGHT,
        'Another operation is already running for this client',
      );
    }
  }

  private acquireWriteLock(
    slug: CatalogKey,
    resources: readonly ClientOperationResource[] = MINECRAFT_WRITE_RESOURCES,
  ): ClientOperationLease {
    const result = this.operationLocks.acquire({
      slug,
      domain: ClientOperationDomains.MINECRAFT,
      resources,
    });
    if (result.kind === 'acquired') return result.lease;
    throw new ManagerError(
      MinecraftErrorCodes.OP_IN_FLIGHT,
      'Another operation is already running for this client',
    );
  }

  private async finishRepair(
    slug: CatalogKey,
    ctx: Context,
    op: RepairOp,
    lock: ClientOperationLease,
  ): Promise<void> {
    let repaired = false;
    try {
      repaired = await runRepair(this.env, slug, ctx, op);
    } finally {
      lock.release();
    }

    const repairHook = this.bundleHookFor(ctx);
    if (!repaired || !repairHook) return;

    // Register a BUNDLE_SYNCING op for the duration of the sync (symmetric with
    // startLaunch's official path) so getStatus reports the sync, cancel(slug)
    // can abort the download, and cancelAll reaches it on quit.
    const bundleOp: Op = { kind: OpKinds.BUNDLE_SYNCING, abort: new AbortController() };
    this.ops.set(slug, bundleOp);
    try {
      await repairHook(slug, bundleOp.abort.signal);
    } catch (error) {
      // On abort the op is being dropped below and getStatus falls back to
      // presence, so the cancel is not an error worth logging.
      if (!bundleOp.abort.signal.aborted) {
        logger.warn(`[${slug}] repair: bundle sync after repair failed`, error);
      }
    } finally {
      this.ops.delete(slug);
    }
  }
}
