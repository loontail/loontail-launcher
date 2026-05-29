import path from 'node:path';
import {
  Loaders,
  type MinecraftKit,
  type ProgressListener,
  type RepairAllReport,
  type RepairAspect,
  type RepairReport,
  type Target,
  type VerificationFileResult,
  type VerificationKind,
  VerificationKinds,
  type VerificationResult,
} from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import type { ClientSlug } from '@shared/contracts/ids';
import { buildContext } from './context';

const logger = scopedLogger('bundle.heal');

export type HealOutcome = {
  // Files the bundle currently owns — never repaired even if kit verify flags
  // them as wrong-sha1 (the bundle deliberately overrides vanilla).
  ignoredByBundle: number;
  // Files outside the bundle's ownership that we actually re-downloaded.
  repaired: number;
  // True when the underlying verify call ran successfully (regardless of
  // whether a repair was needed).
  verifyCompleted: boolean;
};

// Bundle paths come from the manifest in forward-slash form; convert disk
// paths to the same normalisation so set membership is deterministic.
const toBundleKey = (clientFolder: string, absPath: string): string =>
  path.relative(clientFolder, absPath).replace(/\\/g, '/');

// Filter a verification result down to only the issues that don't belong to
// the current bundle. Used to construct a synthetic VerificationResult to feed
// into `kit.repair.minecraft.plan`.
const filterIssues = (
  result: VerificationResult,
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
): readonly VerificationFileResult[] =>
  result.issues.filter((issue) => {
    const key = toBundleKey(clientFolder, issue.path);
    return !bundleOwnedPaths.has(key);
  });

type VerifyAndRepairOptions = {
  signal?: AbortSignal;
  // Forwarded to both `kit.verify.minecraft.run` and `kit.repair.minecraft.run`
  // so callers can surface live progress (verify file counts + repair bytes).
  onEvent?: ProgressListener;
};

type BundleAwareRepairContext = {
  readonly slug: ClientSlug;
  readonly clientFolder: string;
  readonly target: Target;
};

type AspectTaggedProgressEvent = Parameters<ProgressListener>[0] & {
  readonly aspect: VerificationKind;
};

const opOptions = (
  options: VerifyAndRepairOptions | undefined,
): { signal?: AbortSignal; onEvent?: ProgressListener } => ({
  ...(options?.signal ? { signal: options.signal } : {}),
  ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
});

const withAspectOptions = (
  options: VerifyAndRepairOptions | undefined,
  aspect: VerificationKind,
): { signal?: AbortSignal; onEvent?: ProgressListener } => ({
  ...(options?.signal ? { signal: options.signal } : {}),
  ...(options?.onEvent
    ? {
        onEvent: (event) => {
          const tagged: AspectTaggedProgressEvent = { ...event, aspect };
          options.onEvent?.(tagged);
        },
      }
    : {}),
});

const filterResult = (
  result: VerificationResult,
  clientFolder: string,
  bundleOwnedPaths: ReadonlySet<string>,
): { result: VerificationResult; ignoredByBundle: number } => {
  const issues = filterIssues(result, clientFolder, bundleOwnedPaths);
  return {
    ignoredByBundle: result.issues.length - issues.length,
    result: {
      targetId: result.targetId,
      kind: result.kind,
      isValid: issues.length === 0,
      issues,
      checkedFiles: result.checkedFiles,
      durationMs: result.durationMs,
    },
  };
};

const repairAspectFor = (kit: MinecraftKit, kind: VerificationKind): RepairAspect | null => {
  switch (kind) {
    case VerificationKinds.MINECRAFT:
      return kit.repair.minecraft;
    case VerificationKinds.RUNTIME:
      return kit.repair.runtime;
    case VerificationKinds.FABRIC:
      return kit.repair.fabric;
    case VerificationKinds.FORGE:
      return kit.repair.forge;
    default:
      return null;
  }
};

const verifyAllRepairAspects = async (
  kit: MinecraftKit,
  target: Target,
  options?: VerifyAndRepairOptions,
): Promise<VerificationResult[]> => {
  const verifications = [
    await kit.verify.minecraft.run(target, withAspectOptions(options, VerificationKinds.MINECRAFT)),
    await kit.verify.runtime.run(target, withAspectOptions(options, VerificationKinds.RUNTIME)),
  ];
  if (target.loader.type === Loaders.FABRIC) {
    verifications.push(
      await kit.verify.fabric.run(target, withAspectOptions(options, VerificationKinds.FABRIC)),
    );
  } else if (target.loader.type === Loaders.FORGE) {
    verifications.push(
      await kit.verify.forge.run(target, withAspectOptions(options, VerificationKinds.FORGE)),
    );
  }
  return verifications;
};

export const repairAllExceptBundle = async (
  kit: MinecraftKit,
  ctx: BundleAwareRepairContext,
  bundleOwnedPaths: ReadonlySet<string>,
  options?: VerifyAndRepairOptions,
): Promise<{ report: RepairAllReport; ignoredByBundle: number }> => {
  const startedAt = Date.now();
  const rawVerifications = await verifyAllRepairAspects(kit, ctx.target, options);
  const verifications: VerificationResult[] = [];
  const repairs = new Map<VerificationKind, RepairReport>();
  let bytesDownloaded = 0;
  let ignoredByBundle = 0;

  for (const rawVerification of rawVerifications) {
    const filtered = filterResult(rawVerification, ctx.clientFolder, bundleOwnedPaths);
    ignoredByBundle += filtered.ignoredByBundle;
    verifications.push(filtered.result);
    if (filtered.result.isValid) continue;

    const aspect = repairAspectFor(kit, filtered.result.kind);
    if (aspect === null) continue;
    const plan = await aspect.plan(ctx.target, {
      from: filtered.result,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (plan.totalActions === 0) continue;
    const report = await aspect.run(plan, withAspectOptions(options, filtered.result.kind));
    repairs.set(filtered.result.kind, report);
    bytesDownloaded += report.bytesDownloaded;
  }

  return {
    ignoredByBundle,
    report: {
      verifications,
      repairs,
      bytesDownloaded,
      durationMs: Date.now() - startedAt,
    },
  };
};

// Run kit.verify.minecraft, drop any issues for paths the bundle owns, then
// repair only what's left. No-op when the filtered set is empty.
export const verifyAndRepairExceptBundle = async (
  kit: MinecraftKit,
  slug: ClientSlug,
  bundleOwnedPaths: ReadonlySet<string>,
  options?: VerifyAndRepairOptions,
): Promise<HealOutcome> => {
  const ctx = await buildContext(kit, slug);
  const result = await kit.verify.minecraft.run(ctx.target, opOptions(options));

  const filtered = filterResult(result, ctx.clientFolder, bundleOwnedPaths);
  const ignoredByBundle = filtered.ignoredByBundle;

  if (filtered.result.isValid) {
    logger.info(
      `[${slug}] heal: minecraft slice clean (verified=${result.checkedFiles}, ignored=${ignoredByBundle})`,
    );
    return { ignoredByBundle, repaired: 0, verifyCompleted: true };
  }

  logger.info(
    `[${slug}] heal: repairing ${filtered.result.issues.length} minecraft files (ignored ${ignoredByBundle} bundle-owned)`,
  );

  const plan = await kit.repair.minecraft.plan(ctx.target, {
    from: filtered.result,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  await kit.repair.minecraft.run(plan, opOptions(options));

  return {
    ignoredByBundle,
    repaired: plan.totalActions,
    verifyCompleted: true,
  };
};
