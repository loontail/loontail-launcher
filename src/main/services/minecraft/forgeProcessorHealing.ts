import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  InstallActionKinds,
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

  let firstBroken: RunForgeProcessorAction | null = null;
  for (const action of processors) {
    if (!(await processorOutputsOk(action))) {
      firstBroken = action;
      break;
    }
  }

  if (firstBroken === null) {
    logger.info(`[${slug}] processor outputs clean (checked ${processors.length})`);
    return { ranProcessors: false, reranCount: 0 };
  }

  // Forge processors have implicit input→output dependencies (e.g. the
  // jarsplitter step reads mappings-merged.txt produced by an earlier MCP
  // step). They also depend on install-time libraries that kit.repair.forge
  // doesn't track — verify.forge only inspects the Forge *version.json*
  // libraries, not the install_profile.json libraries (where processor JARs
  // like installertools live). So when something's missing we run the full
  // plan: downloads are skip-on-correct (cheap when files exist), and the
  // processor chain re-runs end-to-end with all its classpath libs guaranteed
  // present.
  logger.info(
    `[${slug}] processor output ${firstBroken.index} broken — re-running full forge install plan (${plan.actions.length} actions, ${processors.length} processor(s))`,
  );

  await kit.install.run(plan, signal ? { signal } : undefined);

  return { ranProcessors: true, reranCount: processors.length };
};
