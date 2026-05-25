import path from 'node:path';
import type {
  MinecraftKit,
  ProgressListener,
  VerificationFileResult,
  VerificationResult,
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

const opOptions = (
  options: VerifyAndRepairOptions | undefined,
): { signal?: AbortSignal; onEvent?: ProgressListener } => ({
  ...(options?.signal ? { signal: options.signal } : {}),
  ...(options?.onEvent ? { onEvent: options.onEvent } : {}),
});

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

  const filtered = filterIssues(result, ctx.clientFolder, bundleOwnedPaths);
  const ignoredByBundle = result.issues.length - filtered.length;

  if (filtered.length === 0) {
    logger.info(
      `[${slug}] heal: minecraft slice clean (verified=${result.checkedFiles}, ignored=${ignoredByBundle})`,
    );
    return { ignoredByBundle, repaired: 0, verifyCompleted: true };
  }

  logger.info(
    `[${slug}] heal: repairing ${filtered.length} minecraft files (ignored ${ignoredByBundle} bundle-owned)`,
  );

  // Synthetic result with only the deltas the bundle isn't covering. Kit's
  // repair planner only inspects `issues`/`kind`/`targetId`, so the rest can
  // mirror the original result.
  const syntheticResult: VerificationResult = {
    targetId: result.targetId,
    kind: result.kind,
    isValid: false,
    issues: filtered,
    checkedFiles: result.checkedFiles,
    durationMs: result.durationMs,
  };

  const plan = await kit.repair.minecraft.plan(ctx.target, {
    from: syntheticResult,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  await kit.repair.minecraft.run(plan, opOptions(options));

  return {
    ignoredByBundle,
    repaired: plan.totalActions,
    verifyCompleted: true,
  };
};
