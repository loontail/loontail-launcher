import {
  type InstallPlan,
  Loaders,
  type ProgressListener,
  type RepairAllReport,
  resolveLaunchVersion,
} from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { classifyError } from './errors';
import { repairMissingForgeProcessorOutputs } from './forgeProcessorHealing';
import { persistTargetInstallManifest } from './installManifest';
import { resolveClientInstallPresence } from './readinessPolicy';
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
  readonly slug: CatalogKey;
  readonly error: unknown;
  readonly signal: AbortSignal;
};

// After a repair cancel/failure, report what the offline presence check still
// finds on disk; UNVERIFIED collapses to the caller's not-ready status rather
// than claiming INSTALLED.
const emitPostOpStatus = async (
  env: ManagerEnv,
  slug: CatalogKey,
  notReadyStatus: typeof InstallStatuses.ERROR | typeof InstallStatuses.NOT_INSTALLED,
): Promise<void> => {
  const presence = await resolveClientInstallPresence(slug);
  const status = presence === InstallStatuses.INSTALLED ? presence : notReadyStatus;
  env.emitStatus({ slug, status, paused: false });
};

export const verifyAndRepairBase = async (
  env: ManagerEnv,
  slug: CatalogKey,
  ctx: Context,
  options: RepairOptions,
): Promise<RepairAllReport> => {
  // The bundle-owned filter is injected so the repair path never imports the bundle service.
  const bundleSlug = ctx.item.spec.bundleSlug ?? null;
  const shouldRepairIssue =
    bundleSlug === null ? null : await env.resolveBundleRepairFilter(ctx.clientFolder, bundleSlug);
  const report =
    shouldRepairIssue === null
      ? await env.kit.repair.all(ctx.target, options)
      : await env.kit.repair.all(ctx.target, { ...options, shouldRepairIssue });
  const broken = [...report.repairs.keys()];
  env.logger.info(
    broken.length === 0
      ? `[${slug}] repair: clean`
      : `[${slug}] repair: fixed ${broken.join(', ')}`,
  );
  return report;
};

export type EnsureLaunchableOptions = {
  readonly signal: AbortSignal;
  readonly runPlan: (plan: InstallPlan) => Promise<void>;
};

// True when the launch version JSON resolves from disk. resolveLaunchVersion
// throws for Forge/Fabric when no installed loader version JSON exists; vanilla
// never throws (repair.all already writes its version JSON).
const launchVersionResolvable = async (ctx: Context): Promise<boolean> =>
  resolveLaunchVersion(ctx.target)
    .then(() => true)
    .catch(() => false);

// Last-resort bootstrap: repair.all + healForgeProcessors fix existing files but
// cannot always materialize a loader install from scratch. When the launch version
// still cannot resolve, run the full idempotent install plan to build it; a thrown
// error here surfaces as a real repair failure rather than a silent broken success.
export const ensureLaunchable = async (
  env: ManagerEnv,
  slug: CatalogKey,
  ctx: Context,
  options: EnsureLaunchableOptions,
): Promise<void> => {
  if (await launchVersionResolvable(ctx)) return;
  env.logger.info(
    `[${slug}] repair: launch version JSON missing — running a full install to rebuild it`,
  );
  const plan = await env.kit.install.plan(ctx.target, { signal: options.signal });
  await options.runPlan(plan);
};

export const healForgeProcessors = async (
  env: ManagerEnv,
  slug: CatalogKey,
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
    env.forgeProcessorCache,
    options,
  );
  if (processorOutcome.ranProcessors) {
    env.logger.info(`[${slug}] repair: re-ran ${processorOutcome.reranCount} forge processor(s)`);
  }
};

export const finalizeRepairSuccess = async (
  env: ManagerEnv,
  slug: CatalogKey,
  ctx: Context,
): Promise<void> => {
  env.persistRuntime(slug, {
    component: ctx.target.runtime.component,
    path: runtimePathFor(ctx.target.runtime.component),
  });
  await persistTargetInstallManifest(slug, ctx.clientFolder, ctx.target, 'repair');
  env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
};

export const finalizeRepairCancellation = async (
  env: ManagerEnv,
  slug: CatalogKey,
): Promise<void> => {
  env.logger.info(`[${slug}] repair: cancelled`);
  await emitPostOpStatus(env, slug, InstallStatuses.NOT_INSTALLED);
};

export const finalizeRepairFailure = async (
  input: RepairFailureFinalizationInput,
): Promise<void> => {
  const code = classifyError(input.error, input.signal);
  const message = errorMessage(input.error);
  input.env.logger.error(`[${input.slug}] repair: failed (${code}) - ${message}`, input.error);
  input.env.emitError(input.slug, code, message);
  await emitPostOpStatus(input.env, input.slug, InstallStatuses.ERROR);
};
