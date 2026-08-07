import fs from 'node:fs/promises';
import { PauseController } from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { isCancelled } from '@main/infra/lifecyclePhase';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { MinecraftEnv } from './env';
import { classifyError } from './errors';
import { hasAnyVersionInstalled } from './installedVersions';
import { persistTargetInstallManifest } from './installManifest';
import { type InstallOp, OpKinds } from './ops';
import { createPlannedProgressAdapter, runWithProgressAdapter } from './progressAdapter';
import { runtimePathFor } from './runtimeFs';
import { isUnderClientsRoot } from './uninstall';

export const beginInstall = (
  env: MinecraftEnv,
  key: CatalogKey,
  ctx: Context,
  options: { abort?: AbortController },
): InstallOp => {
  // Carry the placeholder's abort controller forward so a Stop during the
  // buildContext window stays armed (it may already be aborted).
  const op: InstallOp = {
    kind: OpKinds.INSTALL,
    pauseController: new PauseController(),
    abort: options.abort ?? new AbortController(),
    phase: 'running',
  };
  env.ops.set(key, op);
  env.emitStatus({
    key,
    status: InstallStatuses.INSTALLING,
    paused: false,
    loader: ctx.loader,
  });
  env.logger.info(`[${key}] install: started (loader=${ctx.loader})`);
  return op;
};

const emitPostInstallStatus = async (
  env: MinecraftEnv,
  key: CatalogKey,
  clientFolder: string,
): Promise<void> => {
  const installed = await hasAnyVersionInstalled(clientFolder);
  env.emitStatus({
    key,
    status: installed ? InstallStatuses.INSTALLED : InstallStatuses.NOT_INSTALLED,
    paused: false,
  });
};

const handleInstallFailure = async (
  env: MinecraftEnv,
  key: CatalogKey,
  ctx: Context,
  op: InstallOp,
  error: unknown,
): Promise<void> => {
  if (isCancelled(op)) {
    if (isUnderClientsRoot(ctx.clientFolder, ctx.resolved.storage.clientsFolder)) {
      env.logger.info(`[${key}] install: cancelled, cleaning client folder`);
      await fs.rm(ctx.clientFolder, { recursive: true, force: true }).catch((err) => {
        env.logger.warn('Failed to clean up client folder after cancel', err);
      });
    }
    await emitPostInstallStatus(env, key, ctx.clientFolder);
    return;
  }
  const code = classifyError(error, op.abort.signal);
  const message = errorMessage(error);
  env.logger.error(`[${key}] install: failed (${code}) — ${message}`, error);
  env.emitError(key, code, message);
  await emitPostInstallStatus(env, key, ctx.clientFolder);
};

const tryInstall = async (
  env: MinecraftEnv,
  key: CatalogKey,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  const plan = await env.kit.install.plan(ctx.target, { signal: op.abort.signal });
  env.forgeProcessorCache.remember(plan);
  env.logger.info(
    `[${key}] install: plan ready — ${plan.totalActions} actions, ${plan.totalBytes} bytes`,
  );
  await runWithProgressAdapter(createPlannedProgressAdapter(env, key, plan), (onEvent) =>
    env.kit.install.run(plan, {
      signal: op.abort.signal,
      pauseController: op.pauseController,
      onEvent,
    }),
  );
};

export const runInstall = async (
  env: MinecraftEnv,
  key: CatalogKey,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  try {
    env.logger.info(`[${key}] install: planning…`);
    await tryInstall(env, key, ctx, op);
    env.persistRuntime(key, {
      component: ctx.target.runtime.component,
      path: runtimePathFor(ctx.target.runtime.component),
    });
    await persistTargetInstallManifest(key, ctx.clientFolder, ctx.target, 'install');
    env.logger.info(`[${key}] install: done`);
  } catch (error) {
    await handleInstallFailure(env, key, ctx, op, error);
    throw error;
  } finally {
    env.ops.delete(key);
  }
};
