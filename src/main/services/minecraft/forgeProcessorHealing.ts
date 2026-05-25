import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  type DownloadAction,
  type InstallAction,
  InstallActionKinds,
  type InstallPlan,
  Loaders,
  type MinecraftKit,
  type RunForgeProcessorAction,
  type Target,
} from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import type { ClientSlug } from '@shared/contracts/ids';

const logger = scopedLogger('forge.processors');

export type ProcessorHealOutcome = {
  // True when target was Forge and at least one missing/wrong output was repaired.
  // False when target wasn't Forge, or all outputs were already on disk.
  ranProcessors: boolean;
  reranCount: number;
};

const sha1OfFile = async (filePath: string): Promise<string | null> => {
  try {
    return await new Promise<string>((resolve, reject) => {
      const hash = createHash('sha1');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
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
const processorOutputsOk = async (action: RunForgeProcessorAction): Promise<boolean> => {
  for (const [outPath, expectedSha1] of Object.entries(action.outputs)) {
    if (await fileMissing(outPath)) return false;
    const actual = await sha1OfFile(outPath);
    if (actual !== expectedSha1) return false;
  }
  return true;
};

// kit.verify.forge only inspects libraries declared in the Forge version JSON,
// so processor outputs (e.g. <mc>-srg.jar, <mc>-extra.jar, forge-<v>-client.jar)
// slip through — they're generated, not downloaded. This walks the install plan
// for the target and re-runs only the processors whose outputs are missing/broken.
//
// No-op for non-Forge targets.
export const repairMissingForgeProcessorOutputs = async (
  kit: MinecraftKit,
  slug: ClientSlug,
  target: Target,
  signal?: AbortSignal,
): Promise<ProcessorHealOutcome> => {
  if (target.loader.type !== Loaders.FORGE) {
    return { ranProcessors: false, reranCount: 0 };
  }

  const plan = await kit.install.plan(target, signal ? { signal } : undefined);
  const processors = plan.actions.filter(
    (action): action is RunForgeProcessorAction =>
      action.kind === InstallActionKinds.RUN_FORGE_PROCESSOR,
  );
  if (processors.length === 0) return { ranProcessors: false, reranCount: 0 };

  const brokenIndices = new Set<number>();
  for (const action of processors) {
    if (!(await processorOutputsOk(action))) brokenIndices.add(action.index);
  }

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
  const focusedBytes = focusedActions
    .filter((action): action is DownloadAction => action.kind === InstallActionKinds.DOWNLOAD_FILE)
    .reduce((sum, action) => sum + (action.expectedSize ?? 0), 0);
  const focusedPlan: InstallPlan = {
    ...plan,
    actions: focusedActions,
    totalActions: focusedActions.length,
    totalBytes: focusedBytes,
  };

  logger.info(
    `[${slug}] ${brokenIndices.size}/${processors.length} processor output(s) broken — re-running focused plan (${focusedActions.length}/${plan.actions.length} actions)`,
  );

  await kit.install.run(focusedPlan, signal ? { signal } : undefined);

  return { ranProcessors: true, reranCount: brokenIndices.size };
};
