import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  type RunForgeProcessorAction,
  type Target,
} from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import type { CatalogKey } from '@shared/contracts/ids';

const logger = scopedLogger('forge.processors');

export type ProcessorHealOutcome = {
  // True when target was Forge and at least one missing/wrong output was repaired.
  // False when target wasn't Forge, or all outputs were already on disk.
  ranProcessors: boolean;
  reranCount: number;
};

export type ProcessorHealOptions = {
  readonly signal?: AbortSignal;
  readonly runPlan?: (plan: InstallPlan) => Promise<void>;
};

const forgeProcessorCacheKey = (target: Target): string | null => {
  if (target.loader.type !== Loaders.FORGE) return null;
  return JSON.stringify([
    target.directory,
    target.minecraft.version,
    target.loader.fullVersion,
    target.loader.installerUrl,
  ]);
};

const isForgePlanTarget = (target: InstallPlan['target']): target is Target =>
  target.loader?.type === Loaders.FORGE;

const processorActionsFrom = (
  actions: readonly InstallAction[],
): readonly RunForgeProcessorAction[] =>
  actions.filter(
    (action): action is RunForgeProcessorAction =>
      action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR,
  );

export type ForgeProcessorCache = {
  remember: (plan: InstallPlan) => void;
  get: (target: Target) => readonly RunForgeProcessorAction[] | undefined;
  clear: () => void;
};

// Scoped to the MinecraftManager lifecycle (created in its constructor, cleared
// on uninstall) instead of a module-level singleton, so the entries can't leak
// across clients or test runs and don't grow unbounded for the process lifetime.
export const createForgeProcessorCache = (): ForgeProcessorCache => {
  const entries = new Map<string, readonly RunForgeProcessorAction[]>();
  return {
    remember: (plan) => {
      if (!isForgePlanTarget(plan.target)) return;
      const key = forgeProcessorCacheKey(plan.target);
      if (key === null) return;
      entries.set(key, processorActionsFrom(plan.actions));
    },
    get: (target) => {
      const key = forgeProcessorCacheKey(target);
      return key === null ? undefined : entries.get(key);
    },
    clear: () => entries.clear(),
  };
};

const sha1OfFile = async (filePath: string, signal?: AbortSignal): Promise<string | null> => {
  try {
    return await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha1');
      const stream = createReadStream(filePath, signal ? { signal } : undefined);
      // why: destroy the stream on every exit path so an abort mid-hash (or a
      // late error) never leaks the underlying file descriptor.
      const settle = (run: () => void): void => {
        stream.destroy();
        run();
      };
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => settle(() => resolve(hash.digest('hex'))));
      stream.on('error', (error) => settle(() => reject(error)));
    });
  } catch {
    return null;
  }
};

const fileMissing = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return false;
  } catch {
    return true;
  }
};

// True iff every declared output exists on disk and matches its declared SHA-1.
// Forge processors emit deterministic outputs, so any divergence means we need
// to re-run the processor (kit's runProcessor will fail-hard on hash mismatch
// anyway, but checking here lets us skip processors that are already fine).
const processorOutputsOk = async (
  action: RunForgeProcessorAction,
  signal?: AbortSignal,
): Promise<boolean> => {
  for (const [outPath, expectedSha1] of Object.entries(action.outputs)) {
    signal?.throwIfAborted();
    if (await fileMissing(outPath)) return false;
    const actual = await sha1OfFile(outPath, signal);
    if (actual !== expectedSha1) return false;
  }
  return true;
};

const brokenProcessorIndices = async (
  processors: readonly RunForgeProcessorAction[],
  signal?: AbortSignal,
): Promise<ReadonlySet<number>> => {
  const brokenIndices = new Set<number>();
  for (const action of processors) {
    if (!(await processorOutputsOk(action, signal))) brokenIndices.add(action.index);
  }
  return brokenIndices;
};

// kit.verify.forge only inspects libraries declared in the Forge version JSON,
// so processor outputs (e.g. <mc>-srg.jar, <mc>-extra.jar, forge-<v>-client.jar)
// slip through — they're generated, not downloaded. This walks the install plan
// for the target and re-runs only the processors whose outputs are missing/broken.
//
// No-op for non-Forge targets.
export const repairMissingForgeProcessorOutputs = async (
  kit: MinecraftKit,
  slug: CatalogKey,
  target: Target,
  cache: ForgeProcessorCache,
  options: ProcessorHealOptions = {},
): Promise<ProcessorHealOutcome> => {
  if (target.loader.type !== Loaders.FORGE) {
    return { ranProcessors: false, reranCount: 0 };
  }

  const cachedProcessors = cache.get(target);
  if (cachedProcessors !== undefined) {
    const cachedBrokenIndices = await brokenProcessorIndices(cachedProcessors, options.signal);
    if (cachedBrokenIndices.size === 0) {
      logger.info(
        `[${slug}] processor outputs clean from cache (checked ${cachedProcessors.length})`,
      );
      return { ranProcessors: false, reranCount: 0 };
    }
  }

  const plan = await kit.install.plan(
    target,
    options.signal ? { signal: options.signal } : undefined,
  );
  cache.remember(plan);
  const processors = processorActionsFrom(plan.actions);
  if (processors.length === 0) return { ranProcessors: false, reranCount: 0 };

  const brokenIndices = await brokenProcessorIndices(processors, options.signal);

  if (brokenIndices.size === 0) {
    logger.info(`[${slug}] processor outputs clean (checked ${processors.length})`);
    return { ranProcessors: false, reranCount: 0 };
  }

  // Forge processors depend on install-time libraries (install_profile.json
  // classpath entries like installertools) that kit.verify.forge does not
  // track — verify.forge only inspects the Forge *version.json* libraries.
  // So we keep every non-processor action (downloads, extracts, version/log
  // writes): they are skip-on-correct, so present files cost only a SHA
  // check, while any missing classpath lib is repaired before the broken
  // processor runs. Processor actions with outputs already on disk and
  // SHA-matching are dropped — their outputs satisfy downstream inputs.
  const focusedActions: readonly InstallAction[] = plan.actions.filter(
    (action) =>
      action.kind !== InstallActionKinds.RUN_FORGE_PROCESSOR || brokenIndices.has(action.index),
  );
  // Only RUN_FORGE_PROCESSOR actions are dropped, and they carry no bytes, so the
  // plan's byte total is still accurate for the focused subset. Recomputing from
  // DOWNLOAD_FILE actions alone undercounted any non-download byte-bearing work the
  // kit tracker accounts for; carrying plan.totalBytes forward keeps it correct.
  const focusedPlan: InstallPlan = {
    ...plan,
    actions: focusedActions,
    totalActions: focusedActions.length,
    totalBytes: plan.totalBytes,
  };

  logger.info(
    `[${slug}] ${brokenIndices.size}/${processors.length} processor output(s) broken — re-running focused plan (${focusedActions.length}/${plan.actions.length} actions)`,
  );

  const runPlan =
    options.runPlan ??
    (async (planToRun: InstallPlan): Promise<void> => {
      await kit.install.run(planToRun, options.signal ? { signal: options.signal } : undefined);
    });
  await runPlan(focusedPlan);

  return { ranProcessors: true, reranCount: brokenIndices.size };
};
