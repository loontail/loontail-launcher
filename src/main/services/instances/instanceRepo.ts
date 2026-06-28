import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonValidated, writeJsonAtomic } from '@main/infra/atomicFile';
import { scopedLogger } from '@main/infra/logger';
import { type InstanceManifest, InstanceManifestSchema } from '@shared/contracts/instance';

const logger = scopedLogger('instances.repo');
const INSTANCE_MANIFEST_FILE = 'instance.json';

export const instanceManifestPath = (dir: string): string => path.join(dir, INSTANCE_MANIFEST_FILE);

// Reads and validates an instance descriptor. Returns null (not throws) for a
// missing or malformed manifest so the catalog can skip/flag it without one bad
// instance breaking the whole listing.
export const loadInstanceManifest = async (dir: string): Promise<InstanceManifest | null> => {
  const target = instanceManifestPath(dir);
  return readJsonValidated(target, InstanceManifestSchema, {
    onInvalid: () => logger.warn(`Instance manifest at ${target} is malformed; skipping`),
    onReadError: (error) => logger.warn(`Failed to read instance manifest at ${target}`, error),
  });
};

export const saveInstanceManifest = async (
  dir: string,
  manifest: InstanceManifest,
): Promise<void> => {
  await writeJsonAtomic(instanceManifestPath(dir), manifest);
};

export const removeInstanceDir = async (dir: string): Promise<void> => {
  await fs.rm(dir, { recursive: true, force: true });
};
