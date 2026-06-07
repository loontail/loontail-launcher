import {
  type InstallPlan,
  Loaders,
  type ProgressListener,
  type RepairAllReport,
  resolveLaunchVersion,
} from '@loontail/minecraft-kit';
import { errorMessage } from '@main/infra/errorMessage';
import { loadLocalManifest } from '@main/services/bundle/manifestRepo';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { createBundleRepairIssueFilter } from './bundleHealing';
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
  readonly slug: ClientSlug;
  readonly error: unknown;
  readonly signal: AbortSignal;
};

const loadBundleOwnedPaths = async (ctx: Context): Promise<ReadonlySet<string> | null> => {
  const bundleSlug = ctx.item.spec.bundleSlug ?? null;
  if (bundleSlug === null) return null;
  const manifest = await loadLocalManifest(ctx.clientFolder);
  if (manifest?.bundleSlug !== bundleSlug) return null;
  return new Set(Object.keys(manifest.files));
};

// After a repair cancel/failure, report whatever the offline presence check says
// we still have on disk. resolveClientInstallPresence is the single source of
// truth for "do we already have this install?" (also used to seed open-time
// status); here UNVERIFIED (files without our manifest) collapses to the caller's
// not-ready status rather than claiming INSTALLED.
const emitPostOpStatus = async (
  env: ManagerEnv,
  slug: ClientSlug,
  notReadyStatus: typeof InstallStatuses.ERROR | typeof InstallStatuses.NOT_INSTALLED,
): Promise<void> => {
  const presence = await resolveClientInstallPresence(slug);
  const status = presence === InstallStatuses.INSTALLED ? presence : notReadyStatus;
  env.emitStatus({ slug, status, paused: false });
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

export type EnsureLaunchableOptions = {
  readonly signal: AbortSignal;
  readonly runPlan: (plan: InstallPlan) => Promise<void>;
};

// True when the version JSON the launcher will launch can be resolved from disk.
// resolveLaunchVersion throws for Forge/Fabric when no installed loader version
// JSON exists (the case repair.all + healForgeProcessors cannot always bootstrap);
// for vanilla it resolves from the manifest and never throws, so vanilla never
// triggers the fallback (repair.all already writes the vanilla version JSON).
const launchVersionResolvable = async (ctx: Context): Promise<boolean> =>
  resolveLaunchVersion(ctx.target)
    .then(() => true)
    .catch(() => false);

// Last-resort bootstrap. repair.all + healForgeProcessors fix the files of an
// existing install but cannot always materialize a loader install from scratch
// (the Forge installer -> processor -> version JSON chain). If the launch version
// still cannot be resolved after them, run the full, idempotent (skip-on-correct)
// install plan to build it. If even that cannot produce it, the thrown error is
// surfaced as a real repair failure instead of a silently broken "success".
export const ensureLaunchable = async (
  env: ManagerEnv,
  slug: ClientSlug,
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
    env.forgeProcessorCache,
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
  await persistTargetInstallManifest(slug, ctx.clientFolder, ctx.target, 'repair');
  env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
};

export const finalizeRepairCancellation = async (
  env: ManagerEnv,
  slug: ClientSlug,
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
