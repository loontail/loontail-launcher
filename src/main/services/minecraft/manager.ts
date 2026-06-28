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
import { OP_TO_STATUS, type Op, OpKinds, type OpMap, type RepairOp } from './ops';
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

// Optional hook the bundle service installs at boot, awaited in the bundle-sync
// phase so a play click syncs the bundle before the game spawns.
export type LaunchHook = (key: CatalogKey, signal?: AbortSignal) => Promise<void>;

// Active-account probe injected at construction; returns null when signed out,
// which startLaunch turns into NO_ACCOUNT.
export type AccountProvider = () => Account | null;

// Injected from the bundle service so the repair path keeps no static bundle
// import: resolves a kit RepairIssueFilter from on-disk bundle ownership.
export type ResolveBundleRepairFilter = (
  clientFolder: string,
  expectedBundleSlug: string,
) => Promise<RepairIssueFilter | null>;

// Injected from the catalog service so the manager keeps no static catalog import.
export type ResolveBuild = (key: CatalogKey) => Promise<CatalogItem | null>;

export class MinecraftManager {
  private readonly ops: OpMap;
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
    ops: OpMap = new Map(),
  ) {
    this.ops = ops;
    this.kit = kit;
    this.env = {
      kit,
      broadcaster,
      // Must be the same Map the manager holds (consumers mutate it, manager reads it back).
      ops,
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

  // Threads the injected resolveBuild into the context builder so the manager
  // keeps no static catalog dependency.
  private buildContext(slug: CatalogKey, loaderOverride?: LoaderChoice): Promise<Context> {
    return buildContext(this.kit, slug, loaderOverride, { resolveBuild: this.resolveBuild });
  }

  // Consumed by the bundle service so its post-delete heal can verify/repair
  // without importing minecraft.
  async resolveHealTarget(slug: CatalogKey): Promise<{ target: Target; clientFolder: string }> {
    const ctx = await this.buildContext(slug);
    return { target: ctx.target, clientFolder: ctx.clientFolder };
  }

  // Set at most once in production; multiple sets are allowed only in tests.
  attachLaunchHook(hook: LaunchHook): void {
    this.launchHook = hook;
  }

  // Only official builds have a managed overlay; LOCAL builds load loose mods
  // natively, so skip the hook (it would fail resolving them as an official client).
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
    // Opening the launcher must not verify the install (no hashing, network, or
    // target resolve): report from local files only. The real check runs at Play.
    return {
      status: await resolveClientInstallPresence(slug),
      paused: false,
    };
  }

  async startInstall(slug: CatalogKey, loaderOverride?: LoaderChoice): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
    // Claim the slug before the buildContext await so a concurrent startLaunch
    // trips requireIdle instead of racing ops.set; a Stop here aborts the
    // placeholder controller, which beginInstall carries forward.
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
        // Release before the bundle phase, which acquires the same CLIENT_FOLDER
        // lease and would otherwise self-block with OP_IN_FLIGHT.
        lock.release();
      }
      // Emit INSTALLED before the bundle phase so the UI can swap the progress
      // card to bundle sync (which only renders on an installed client).
      this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
      const installHook = this.bundleHookFor(ctx);
      if (installHook) {
        // The Minecraft install is already done and INSTALLED is emitted, so a
        // bundle failure (surfaced via the bundle.error channel) keeps that state.
        await this.runBundleSyncPhase(slug, installHook, {
          onFailure: (error) =>
            logger.warn(`[${slug}] install: bundle sync after install failed`, error),
        });
      }
    })().catch(() => {
      // Already reported by handleInstallFailure.
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
        // Uninstall has no abort controller; warn so a Stop click during it is
        // traceable rather than a silent no-op.
        logger.warn(`[${slug}] cancel ignored: uninstall is not cancellable`);
        return;
      case OpKinds.LAUNCH:
        // The kit-owned game session is torn down via stop() (user-stop), not here.
        return;
      default:
        assertNever(op);
    }
  }

  async startRepair(slug: CatalogKey): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
    // Register the op before the buildContext await so getStatus reports REPAIRING
    // during setup and a concurrent startRepair trips requireIdle.
    const op: Op = { kind: OpKinds.REPAIR, abort: new AbortController() };
    this.ops.set(slug, op);
    lock.setCancel(() => this.cancel(slug));
    this.env.emitStatus({ slug, status: InstallStatuses.REPAIRING, paused: false });
    let ctx: Context;
    try {
      // No "installed enough" gate: buildContext enforces a configured folder and
      // kit.repair.all rebuilds whatever is missing, so repair runs from any state.
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
    // Claim the slug synchronously (no await between check and claim) so a second
    // concurrent startLaunch trips requireIdle instead of spawning two sessions.
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

    // A Stop during buildContext aborts startingOp without throwing, so the catch
    // above never runs — honor the cancel here before spawning anything.
    if (startingOp.abort.signal.aborted) {
      if (this.ops.get(slug) === startingOp) this.ops.delete(slug);
      this.env.emitStatus({
        slug,
        status: await resolveClientInstallPresence(slug),
        paused: false,
      });
      return;
    }

    // Local builds skip the sync phase and launch directly (see bundleHookFor).
    const launchHook = this.bundleHookFor(ctx);
    if (launchHook) {
      this.env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
      const settleInstalled = () =>
        this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
      // Settle back to INSTALLED on abort/failure and do not proceed to runLaunch:
      // the base game is still launchable, and the failure already reached the
      // renderer via the bundle error channel — propagating would double-surface it.
      const outcome = await this.runBundleSyncPhase(slug, launchHook, {
        onAbort: settleInstalled,
        onFailure: (error) => {
          logger.error(`[${slug}] launch: bundle sync failed`, error);
          settleInstalled();
        },
      });
      if (outcome !== 'completed') return;
    }

    await runLaunch(this.env, slug, ctx, checkedAccount);
  }

  stop(slug: CatalogKey): void {
    const op = this.ops.get(slug);
    if (op?.kind === OpKinds.LAUNCH) op.session.abort('user-stop');
  }

  // Abort in-flight ops on shutdown, notably a bundle sync whose open socket
  // would otherwise block Electron's quit until the request times out.
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
          // UNINSTALL is uninterruptible; LAUNCH is the user's live game session.
          break;
        default:
          assertNever(op);
      }
    }
  }

  // Shared body of the post-install / pre-launch / post-repair bundle sync. Claims
  // a BUNDLE_SYNCING op (so cancel/cancelAll can abort the download), awaits the
  // hook, and decodes the outcome once: a cancel → 'aborted' (silent), any other
  // rejection → 'failed'. Never rethrows.
  private async runBundleSyncPhase(
    slug: CatalogKey,
    hook: LaunchHook,
    handlers: { onAbort?: () => void; onFailure?: (error: unknown) => void } = {},
  ): Promise<'completed' | 'aborted' | 'failed'> {
    const bundleOp: Op = { kind: OpKinds.BUNDLE_SYNCING, abort: new AbortController() };
    this.ops.set(slug, bundleOp);
    try {
      await hook(slug, bundleOp.abort.signal);
      return 'completed';
    } catch (error) {
      if (bundleOp.abort.signal.aborted) {
        handlers.onAbort?.();
        return 'aborted';
      }
      handlers.onFailure?.(error);
      return 'failed';
    } finally {
      this.ops.delete(slug);
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

    await this.runBundleSyncPhase(slug, repairHook, {
      onFailure: (error) => logger.warn(`[${slug}] repair: bundle sync after repair failed`, error),
    });
  }
}
