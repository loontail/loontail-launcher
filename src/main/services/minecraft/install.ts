import fs from 'node:fs/promises';
import {
  type InstallProgressTracker,
  PauseController,
  type ProgressSnapshot,
  createInstallProgressTracker,
} from '@loontail/minecraft-kit';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError, errorMessage } from './errors';
import { type InstallOp, OpKinds } from './ops';
import { runtimePathFor } from './runtimeFs';
import { isAnythingInstalled } from './runtimeState';
import { isUnderClientsRoot } from './uninstall';

export const beginInstall = (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  options: { fresh: boolean },
): InstallOp => {
  const op: InstallOp = {
    kind: OpKinds.INSTALL,
    pauseController: new PauseController(),
    abort: new AbortController(),
    paused: false,
    cancelled: false,
    fresh: options.fresh,
  };
  env.ops.set(slug, op);
  env.emitStatus({
    slug,
    status: InstallStatuses.INSTALLING,
    paused: false,
    loader: ctx.loader,
  });
  env.logger.info(`[${slug}] install: started (loader=${ctx.loader}, fresh=${options.fresh})`);
  return op;
};

const subscribeProgress = (
  env: ManagerEnv,
  slug: ClientSlug,
  tracker: InstallProgressTracker,
): (() => void) =>
  tracker.subscribe((snap: ProgressSnapshot) => {
    env.broadcaster.progress({
      slug,
      stage: snap.stage,
      stagePercent: snap.stagePercent,
      overallPercent: snap.overallPercent,
      bytesDownloaded: snap.bytesDownloaded,
      totalBytes: snap.totalBytes,
      ...(snap.currentFile !== undefined ? { currentFile: snap.currentFile } : {}),
    });
  });

const emitPostInstallStatus = async (
  env: ManagerEnv,
  slug: ClientSlug,
  clientFolder: string,
): Promise<void> => {
  const installed = await isAnythingInstalled(clientFolder);
  env.emitStatus({
    slug,
    status: installed ? InstallStatuses.INSTALLED : InstallStatuses.NOT_INSTALLED,
    paused: false,
  });
};

const handleInstallFailure = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: InstallOp,
  error: unknown,
): Promise<void> => {
  if (op.abort.signal.aborted && op.cancelled) {
    if (op.fresh && isUnderClientsRoot(ctx.clientFolder, ctx.resolved.storage.clientsFolder)) {
      env.logger.info(`[${slug}] install: cancelled, cleaning client folder`);
      await fs.rm(ctx.clientFolder, { recursive: true, force: true }).catch((err) => {
        env.logger.warn('Failed to clean up client folder after cancel', err);
      });
    } else {
      env.logger.info(`[${slug}] install: cancelled, keeping existing folder`);
    }
    await emitPostInstallStatus(env, slug, ctx.clientFolder);
    return;
  }
  const code = classifyError(error, op.abort.signal);
  const message = errorMessage(error);
  env.logger.error(`[${slug}] install: failed (${code}) — ${message}`, error);
  env.emitError(slug, code, message);
  await emitPostInstallStatus(env, slug, ctx.clientFolder);
};

export const runInstall = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  try {
    env.logger.info(`[${slug}] install: planning…`);
    const plan = await env.kit.install.plan(ctx.target, { signal: op.abort.signal });
    env.logger.info(
      `[${slug}] install: plan ready — ${plan.totalActions} actions, ${plan.totalBytes} bytes`,
    );

    const tracker = createInstallProgressTracker(plan);
    const unsubscribe = subscribeProgress(env, slug, tracker);
    try {
      await env.kit.install.run(plan, {
        signal: op.abort.signal,
        pauseController: op.pauseController,
        onEvent: tracker.onEvent,
      });
    } finally {
      tracker.finish();
      unsubscribe();
    }
    // No derivable equivalent for runtime path elsewhere in settings.
    env.persistRuntime(slug, {
      component: ctx.target.runtime.component,
      path: runtimePathFor(ctx.target.runtime.component),
    });
    env.logger.info(`[${slug}] install: done`);
  } catch (error) {
    await handleInstallFailure(env, slug, ctx, op, error);
    throw error;
  } finally {
    env.ops.delete(slug);
  }
};
