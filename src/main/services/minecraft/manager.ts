import type { MinecraftKit } from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import {
  ClientOperationDomains,
  type ClientOperationLease,
  type ClientOperationLocks,
  createClientOperationLocks,
} from '@main/services/clientOperationLocks';
import {
  getSettings,
  setClientOverride as persistClientOverride,
} from '@main/services/settings/settings';
import type { Account } from '@shared/contracts/account';
import type { ClientSlug } from '@shared/contracts/ids';
import {
  type InstallStatus,
  InstallStatuses,
  MinecraftErrorCodes,
  type MinecraftErrorEvent,
  type MinecraftStatusEvent,
} from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { resolveClientSettings } from '@shared/domain/settings';
import type { Broadcaster } from './broadcast';
import { buildContext } from './context';
import type { ManagerEnv } from './env';
import { ManagerError } from './errors';
import { beginInstall, runInstall } from './install';
import { requireAccount, runLaunch } from './launch';
import { OP_TO_STATUS, type Op, OpKinds } from './ops';
import { runRepair } from './repair';
import { isAnythingInstalled, isTargetReady } from './runtimeState';
import { runUninstall } from './uninstall';

const logger = scopedLogger('minecraft');

// Optional hook the bundle service installs at boot; awaited after the
// implicit install step in startLaunch so a play click syncs the bundle
// before the game process is spawned. Untouched when no bundle is wired.
export type LaunchHook = (slug: ClientSlug, signal?: AbortSignal) => Promise<void>;

export class MinecraftManager {
  private readonly ops = new Map<ClientSlug, Op>();
  private readonly env: ManagerEnv;
  private readonly kit: MinecraftKit;
  private launchHook: LaunchHook | null = null;

  constructor(
    broadcaster: Broadcaster,
    kit: MinecraftKit,
    private readonly operationLocks: ClientOperationLocks = createClientOperationLocks(),
  ) {
    this.kit = kit;
    this.env = {
      kit,
      broadcaster,
      ops: this.ops,
      logger,
      emitStatus: (payload: MinecraftStatusEvent) => broadcaster.status(payload),
      emitError: (slug, code, message) => broadcaster.error({ slug, code, message }),
      emitErrorEvent: (payload: MinecraftErrorEvent) => broadcaster.error(payload),
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
    };
  }

  // Called once at boot (after createBundleService) so launches dovetail
  // through the bundle sync. Replacing a non-null hook is allowed and only
  // happens in tests; in production it's set exactly once.
  attachLaunchHook(hook: LaunchHook): void {
    this.launchHook = hook;
  }

  async getStatus(slug: ClientSlug): Promise<{ status: InstallStatus; paused: boolean }> {
    const op = this.ops.get(slug);
    if (op) {
      if (op.kind === OpKinds.INSTALL) {
        return {
          status: op.status,
          paused: op.status === InstallStatuses.INSTALLING ? op.paused : false,
        };
      }
      return {
        status: OP_TO_STATUS[op.kind],
        paused: false,
      };
    }
    try {
      const ctx = await buildContext(this.kit, slug);
      return {
        status: (await isTargetReady(this.kit, ctx.target))
          ? InstallStatuses.INSTALLED
          : InstallStatuses.NOT_INSTALLED,
        paused: false,
      };
    } catch {
      // Status seeding must tolerate settings or clients that cannot build a target yet.
    }
    const folder = this.clientFolderOrNull(slug);
    const installed = folder ? await isAnythingInstalled(folder) : false;
    return {
      status: installed ? InstallStatuses.INSTALLED : InstallStatuses.NOT_INSTALLED,
      paused: false,
    };
  }

  async startInstall(slug: ClientSlug, loaderOverride?: LoaderChoice): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
    const ctx = await buildContext(this.kit, slug, loaderOverride).catch((error: unknown) => {
      lock.release();
      throw error;
    });
    const op = beginInstall(this.env, slug, ctx, { fresh: true });
    // runInstall handles errors internally (emits via handleInstallFailure) and
    // rethrows for the launch path; in the fire-and-forget case we only need
    // the final INSTALLED status on success.
    void runInstall(this.env, slug, ctx, op)
      .then(async () => {
        lock.release();
        // Mark Minecraft itself as installed BEFORE the bundle phase. The UI
        // listens for INSTALLED to switch the progress card from "downloading
        // minecraft" to "syncing bundle" (which only renders on top of an
        // installed client).
        this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
        if (this.launchHook) {
          try {
            await this.launchHook(slug);
          } catch (error) {
            // Bundle failures surface via the bundle.error event channel; the
            // Minecraft install itself is done, so we keep the INSTALLED state.
            logger.warn(`[${slug}] install: bundle sync after install failed`, error);
          }
        }
      })
      .catch(() => {
        // Already reported by handleInstallFailure; nothing to do here.
      })
      .finally(() => {
        lock.release();
      });
  }

  pause(slug: ClientSlug): void {
    const op = this.ops.get(slug);
    if (op?.kind !== OpKinds.INSTALL) return;
    if (op.status !== InstallStatuses.INSTALLING) return;
    op.paused = true;
    op.pauseController.pause();
    this.env.emitStatus({ slug, status: InstallStatuses.INSTALLING, paused: true });
  }

  resume(slug: ClientSlug): void {
    const op = this.ops.get(slug);
    if (op?.kind !== OpKinds.INSTALL) return;
    if (op.status !== InstallStatuses.INSTALLING) return;
    op.paused = false;
    op.pauseController.resume();
    this.env.emitStatus({ slug, status: InstallStatuses.INSTALLING, paused: false });
  }

  cancel(slug: ClientSlug): void {
    const op = this.ops.get(slug);
    if (!op) return;
    if (op.kind === OpKinds.INSTALL) {
      op.cancelled = true;
      op.pauseController.resume();
      op.abort.abort();
    } else if (op.kind === OpKinds.REPAIR) {
      op.abort.abort();
    } else if (op.kind === OpKinds.BUNDLE_SYNCING) {
      op.abort.abort();
    } else if (op.kind === OpKinds.LAUNCH_STARTING) {
      op.abort.abort();
    }
  }

  async startRepair(slug: ClientSlug): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
    try {
      const ctx = await buildContext(this.kit, slug);
      if (!(await isAnythingInstalled(ctx.clientFolder))) {
        throw new ManagerError(MinecraftErrorCodes.NOT_INSTALLED, 'Client is not installed');
      }
      const op: Op = { kind: OpKinds.REPAIR, abort: new AbortController() };
      this.ops.set(slug, op);
      this.env.emitStatus({ slug, status: InstallStatuses.REPAIRING, paused: false });

      // runRepair never throws; it handles errors internally via emitError +
      // emitStatus and always clears the ops map in finally.
      void runRepair(this.env, slug, ctx, op).finally(() => {
        lock.release();
      });
    } catch (error) {
      lock.release();
      throw error;
    }
  }

  async uninstall(slug: ClientSlug): Promise<void> {
    this.requireIdle(slug);
    const lock = this.acquireWriteLock(slug);
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

  async startLaunch(slug: ClientSlug, account: Account | null): Promise<void> {
    this.requireIdle(slug);
    const ctx = await buildContext(this.kit, slug);
    const checkedAccount = requireAccount(account);

    if (!(await isTargetReady(this.kit, ctx.target))) {
      logger.info(`[${slug}] play: target version missing on disk — installing first`);
      const lock = this.acquireWriteLock(slug);
      const op = beginInstall(this.env, slug, ctx, {
        fresh: !(await isAnythingInstalled(ctx.clientFolder)),
      });
      try {
        await runInstall(this.env, slug, ctx, op);
      } catch (error) {
        if (op.cancelled) return;
        throw error;
      } finally {
        lock.release();
      }
    }

    // Chain the bundle sync before launch. The hook resolves immediately for
    // clients without a bundleSlug, so this is free in the no-bundle path.
    // Install a BundleSyncingOp so `cancel(slug)` can abort the download
    // mid-flight — otherwise the launch flow keeps awaiting `syncForLaunch`
    // long after the user clicked Stop.
    if (this.launchHook) {
      const bundleOp: Op = { kind: OpKinds.BUNDLE_SYNCING, abort: new AbortController() };
      this.ops.set(slug, bundleOp);
      this.env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
      try {
        await this.launchHook(slug, bundleOp.abort.signal);
      } catch (error) {
        if (bundleOp.abort.signal.aborted) {
          this.env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
          return;
        }
        logger.error(`[${slug}] launch: bundle sync failed`, error);
        throw error;
      } finally {
        this.ops.delete(slug);
      }
    }

    await runLaunch(this.env, slug, ctx, checkedAccount);
  }

  stop(slug: ClientSlug): void {
    const op = this.ops.get(slug);
    if (op?.kind === OpKinds.LAUNCH) op.session.abort('user-stop');
  }

  // Called on app shutdown so install/repair ops are told to abort before the
  // process exits. Launching ops are left alone — kit owns the spawned game
  // session and killing it from here would interrupt the user's actual play.
  cancelAll(): void {
    const slugs = [...this.ops.keys()];
    for (const slug of slugs) {
      const op = this.ops.get(slug);
      if (!op) continue;
      if (
        op.kind === OpKinds.INSTALL ||
        op.kind === OpKinds.REPAIR ||
        op.kind === OpKinds.LAUNCH_STARTING
      ) {
        this.cancel(slug);
      }
    }
  }

  private clientFolderOrNull(slug: ClientSlug): string | null {
    return resolveClientSettings(getSettings(), slug).storage.clientFolder || null;
  }

  private requireIdle(slug: ClientSlug): void {
    if (this.ops.has(slug)) {
      throw new ManagerError(
        MinecraftErrorCodes.OP_IN_FLIGHT,
        'Another operation is already running for this client',
      );
    }
  }

  private acquireWriteLock(slug: ClientSlug): ClientOperationLease {
    const result = this.operationLocks.acquire(slug, ClientOperationDomains.MINECRAFT);
    if (result.kind === 'acquired') return result.lease;
    throw new ManagerError(
      MinecraftErrorCodes.OP_IN_FLIGHT,
      'Another operation is already running for this client',
    );
  }
}
