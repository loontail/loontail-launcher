import fs from 'node:fs/promises';
import { type MinecraftKitError, PauseController } from '@loontail/minecraft-kit';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError, errorMessage, tryAsSmartResumeError } from './errors';
import { rememberForgeProcessorActions } from './forgeProcessorHealing';
import { saveCurrentTargetInstallManifest } from './installManifest';
import { type InstallOp, OpKinds } from './ops';
import { createPlannedProgressAdapter, runWithProgressAdapter } from './progressAdapter';
import { runtimePathFor } from './runtimeFs';
import { invalidateRuntimeVerification, isAnythingInstalled } from './runtimeState';
import { isUnderClientsRoot } from './uninstall';

export const beginInstall = (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  options: { fresh: boolean },
): InstallOp => {
  const op: InstallOp = {
    kind: OpKinds.INSTALL,
    status: InstallStatuses.INSTALLING,
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

const persistTargetInstallManifest = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
): Promise<void> => {
  try {
    await saveCurrentTargetInstallManifest(ctx.clientFolder, ctx.target);
  } catch (error) {
    env.logger.warn(`[${slug}] install: failed to persist target install manifest`, error);
  }
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

// Plan + tracker + run. Reused by both the initial attempt and the
// smart-resume continuation so they share progress wiring and abort handling.
const tryInstall = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  const plan = await env.kit.install.plan(ctx.target, { signal: op.abort.signal });
  rememberForgeProcessorActions(plan);
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

// One automatic recovery pass for transient install failures kit can derive a
// focused repair plan from (network jitter, integrity mismatch on a single
// artefact, partial write, broken forge processor chain). The repair runner
// is aspect-agnostic — kit feeds the filtered plan into the same install
// runner internally — so kit.repair.minecraft.run handles plans derived from
// any aspect's failure (per the RepairFromErrorInput docstring example).
// Continuation re-runs the install plan; kit's skip-on-correct breezes past
// already-valid files.
//
// Returns true iff the recovery + continuation both succeeded. Any failure
// inside this path collapses to false, and the caller escalates the *original*
// install error — the user shouldn't see "smart resume failed", they should
// see the same error they would have seen without this path.
const attemptSmartResume = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: InstallOp,
  originalError: MinecraftKitError,
): Promise<boolean> => {
  env.logger.info(`[${slug}] install: ${originalError.code} caught — attempting smart resume`);
  op.status = InstallStatuses.REPAIRING;
  env.emitStatus({ slug, status: InstallStatuses.REPAIRING, paused: false });
  try {
    const resumePlan = await env.kit.repair.fromError({
      error: originalError,
      target: ctx.target,
      signal: op.abort.signal,
    });
    env.logger.info(
      `[${slug}] install: resume plan ready — ${resumePlan.totalActions} actions, ${resumePlan.totalBytes} bytes`,
    );
    await runWithProgressAdapter(createPlannedProgressAdapter(env, slug, resumePlan), (onEvent) =>
      env.kit.repair.minecraft.run(resumePlan, {
        signal: op.abort.signal,
        onEvent,
      }),
    );
    env.logger.info(`[${slug}] install: resume repair done, continuing install`);
    op.status = InstallStatuses.INSTALLING;
    env.emitStatus({
      slug,
      status: InstallStatuses.INSTALLING,
      paused: false,
      loader: ctx.loader,
    });
    await tryInstall(env, slug, ctx, op);
    env.logger.info(`[${slug}] install: smart resume completed install`);
    return true;
  } catch (resumeError) {
    env.logger.warn(
      `[${slug}] install: smart resume failed, escalating original error`,
      resumeError,
    );
    return false;
  }
};

export const runInstall = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  op: InstallOp,
): Promise<void> => {
  try {
    env.logger.info(`[${slug}] install: planning…`);
    let recovered = false;
    try {
      await tryInstall(env, slug, ctx, op);
    } catch (firstError) {
      const resumable = tryAsSmartResumeError(firstError, op.abort.signal);
      if (resumable === null) throw firstError;
      const ok = await attemptSmartResume(env, slug, ctx, op, resumable);
      if (!ok) throw firstError;
      recovered = true;
    }
    // No derivable equivalent for runtime path elsewhere in settings.
    env.persistRuntime(slug, {
      component: ctx.target.runtime.component,
      path: runtimePathFor(ctx.target.runtime.component),
    });
    await persistTargetInstallManifest(env, slug, ctx);
    env.logger.info(
      recovered
        ? `[${slug}] install: done (recovered via smart resume)`
        : `[${slug}] install: done`,
    );
  } catch (error) {
    await handleInstallFailure(env, slug, ctx, op, error);
    throw error;
  } finally {
    invalidateRuntimeVerification(ctx.target);
    env.ops.delete(slug);
  }
};
