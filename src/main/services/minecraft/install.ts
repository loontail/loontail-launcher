import fs from 'node:fs/promises';
import { PauseController } from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError } from './errors';
import { persistTargetInstallManifest } from './installManifest';
import { type InstallOp, OpKinds } from './ops';
import { createPlannedProgressAdapter, runWithProgressAdapter } from './progressAdapter';
import { runtimePathFor } from './runtimeFs';
import { isAnythingInstalled } from './runtimeState';
import { isUnderClientsRoot } from './uninstall';

export const beginInstall = (
  env: ManagerEnv,
  slug: CatalogKey,
  ctx: Context,
  options: { abort?: AbortController },
): InstallOp => {
  // Carry the placeholder's abort controller forward when startInstall passes
  // one, so a Stop issued during the buildContext window stays armed: the
  // controller may already be aborted, and runInstall's signal honors it.
  const op: InstallOp = {
    kind: OpKinds.INSTALL,
    pauseController: new PauseController(),
    abort: options.abort ?? new AbortController(),
    paused: false,
    cancelled: false,
  };
  env.ops.set(slug, op);
  env.emitStatus({
    slug,
    status: InstallStatuses.INSTALLING,
    paused: false,
    loader: ctx.loader,
  });
  env.logger.info(`[${slug}] install: started (loader=${ctx.loader})`);
  return op;
};

const emitPostInstallStatus = async (
  env: ManagerEnv,
  slug: CatalogKey,
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
  slug: CatalogKey,
  ctx: Context,
  op: InstallOp,
  error: unknown,
): Promise<void> => {
  if (op.abort.signal.aborted && op.cancelled) {
    if (isUnderClientsRoot(ctx.clientFolder, ctx.resolved.storage.clientsFolder)) {
      env.logger.info(`[${slug}] install: cancelled, cleaning client folder`);
      await fs.rm(ctx.clientFolder, { recursive: true, force: true }).catch((err) => {
        env.logger.warn('Failed to clean up client folder after cancel', err);
      });
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

const tryInstall = async (
  env: ManagerEnv,
  slug: CatalogKey,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  const plan = await env.kit.install.plan(ctx.target, { signal: op.abort.signal });
  env.forgeProcessorCache.remember(plan);
  env.logger.info(
    `[${slug}] install: plan ready — ${plan.totalActions} actions, ${plan.totalBytes} bytes`,
  );
  await runWithProgressAdapter(createPlannedProgressAdapter(env, slug, plan), (onEvent) =>
    env.kit.install.run(plan, {
      signal: op.abort.signal,
      pauseController: op.pauseController,
      onEvent,
    }),
  );
};

export const runInstall = async (
  env: ManagerEnv,
  slug: CatalogKey,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  try {
    env.logger.info(`[${slug}] install: planning…`);
    await tryInstall(env, slug, ctx, op);
    // No derivable equivalent for runtime path elsewhere in settings.
    env.persistRuntime(slug, {
      component: ctx.target.runtime.component,
      path: runtimePathFor(ctx.target.runtime.component),
    });
    await persistTargetInstallManifest(slug, ctx.clientFolder, ctx.target, 'install');
    env.logger.info(`[${slug}] install: done`);
  } catch (error) {
    await handleInstallFailure(env, slug, ctx, op, error);
    throw error;
  } finally {
    env.ops.delete(slug);
  }
};
