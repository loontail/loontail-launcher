import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Loaders,
  type MinecraftKit,
  type Target,
  type VerificationResult,
  type VerifyOperationOptions,
} from '@loontail/minecraft-kit';

const VERSIONS_DIR = 'versions';

type TargetReadyVerifier = {
  readonly targetReady?: {
    run(target: Target, options?: VerifyOperationOptions): Promise<{ readonly isReady: boolean }>;
  };
};

// "Installed" = the client folder has at least one `versions/<id>/<id>.json`.
// No sidecar state file; the kit's own output is the source of truth.
export const isAnythingInstalled = async (clientFolder: string): Promise<boolean> => {
  if (!clientFolder) return false;
  const versionsRoot = path.join(clientFolder, VERSIONS_DIR);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(versionsRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(versionsRoot, entry.name, `${entry.name}.json`);
    try {
      await fs.access(jsonPath);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
};

// "Ready" = the kit can verify every launch-critical aspect for this target.
export const isTargetReady = async (kit: MinecraftKit, target: Target): Promise<boolean> => {
  try {
    const verifier = kit.verify as MinecraftKit['verify'] & TargetReadyVerifier;
    if (verifier.targetReady !== undefined) {
      return (await verifier.targetReady.run(target)).isReady;
    }
    const results = await verifyTargetAspects(kit, target);
    return results.every((result) => result.isValid);
  } catch {
    return false;
  }
};

const verifyTargetAspects = async (
  kit: MinecraftKit,
  target: Target,
): Promise<readonly VerificationResult[]> => {
  const results = [await kit.verify.minecraft.run(target), await kit.verify.runtime.run(target)];
  if (target.loader.type === Loaders.FABRIC) {
    results.push(await kit.verify.fabric.run(target));
  } else if (target.loader.type === Loaders.FORGE) {
    results.push(await kit.verify.forge.run(target));
  }
  return results;
};
