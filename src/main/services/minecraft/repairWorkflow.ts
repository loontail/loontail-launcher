import {
  type InstallPlan,
  Loaders,
  type ProgressListener,
  type RepairAllReport,
} from '@loontail/minecraft-kit';
import { loadLocalManifest } from '@main/services/bundle/manifestRepo';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { createBundleRepairIssueFilter } from './bundleHealing';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError, errorMessage } from './errors';
import { repairMissingForgeProcessorOutputs } from './forgeProcessorHealing';
import { saveCurrentTargetInstallManifest } from './installManifest';
import { ReadinessPolicyKinds, resolveTargetReadinessPolicy } from './readinessPolicy';
import { runtimePathFor } from './runtimeFs';

type RepairOptions = {
  readonly signal: AbortSignal;
  readonly onEvent: ProgressListener;
};

type ForgeProcessorHealOptions = {
  readonly signal: AbortSignal;
  readonly runPlan: (plan: InstallPlan) => Promise<void>;
};

export type RepairFailureFinalizationInput = {
  readonly env: ManagerEnv;
  readonly slug: ClientSlug;
  readonly ctx: Context;
  readonly error: unknown;
  readonly signal: AbortSignal;
};

const loadBundleOwnedPaths = async (ctx: Context): Promise<ReadonlySet<string> | null> => {
  const bundleSlug = ctx.client.bundleSlug ?? null;
  if (bundleSlug === null) return null;
  const manifest = await loadLocalManifest(ctx.clientFolder);
  if (manifest?.bundleSlug !== bundleSlug) return null;
  return new Set(Object.keys(manifest.files));
};

const emitReadinessStatus = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  notReadyStatus: typeof InstallStatuses.ERROR | typeof InstallStatuses.NOT_INSTALLED,
): Promise<void> => {
  const readiness = await resolveTargetReadinessPolicy(env.kit, ctx);
  const status =
    readiness.kind === ReadinessPolicyKinds.INSTALLED ? InstallStatuses.INSTALLED : notReadyStatus;
  env.emitStatus({ slug, status, paused: false });
};

const persistTargetInstallManifest = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
): Promise<void> => {
  try {
    await saveCurrentTargetInstallManifest(ctx.clientFolder, ctx.target);
  } catch (error) {
    env.logger.warn(`[${slug}] repair: failed to persist target install manifest`, error);
  }
};

export const verifyAndRepairBase = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  options: RepairOptions,
): Promise<RepairAllReport> => {
  const bundleOwnedPaths = await loadBundleOwnedPaths(ctx);
  const report =
    bundleOwnedPaths === null
      ? await env.kit.repair.all(ctx.target, options)
      : await env.kit.repair.all(ctx.target, {
          ...options,
          shouldRepairIssue: createBundleRepairIssueFilter(ctx.clientFolder, bundleOwnedPaths),
        });
  const broken = [...report.repairs.keys()];
  env.logger.info(
    broken.length === 0
      ? `[${slug}] repair: clean`
      : `[${slug}] repair: fixed ${broken.join(', ')}`,
  );
  return report;
};

export const healForgeProcessors = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  options: ForgeProcessorHealOptions,
): Promise<void> => {
  if (ctx.target.loader.type !== Loaders.FORGE) {
    return;
  }
  const processorOutcome = await repairMissingForgeProcessorOutputs(
    env.kit,
    slug,
    ctx.target,
    options,
  );
  if (processorOutcome.ranProcessors) {
    env.logger.info(`[${slug}] repair: re-ran ${processorOutcome.reranCount} forge processor(s)`);
  }
};

export const finalizeRepairSuccess = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
): Promise<void> => {
  env.persistRuntime(slug, {
    component: ctx.target.runtime.component,
    path: runtimePathFor(ctx.target.runtime.component),
  });
  await persistTargetInstallManifest(env, slug, ctx);
  env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
};

export const finalizeRepairCancellation = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
): Promise<void> => {
  env.logger.info(`[${slug}] repair: cancelled`);
  await emitReadinessStatus(env, slug, ctx, InstallStatuses.NOT_INSTALLED);
};

export const finalizeRepairFailure = async (
  input: RepairFailureFinalizationInput,
): Promise<void> => {
  const code = classifyError(input.error, input.signal);
  const message = errorMessage(input.error);
  input.env.logger.error(`[${input.slug}] repair: failed (${code}) - ${message}`, input.error);
  input.env.emitError(input.slug, code, message);
  await emitReadinessStatus(input.env, input.slug, input.ctx, InstallStatuses.ERROR);
};
