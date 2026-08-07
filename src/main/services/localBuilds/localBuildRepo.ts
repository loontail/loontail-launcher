import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonValidated, writeJsonAtomic } from '@main/infra/atomicFile';
import { scopedLogger } from '@main/infra/logger';
import { type LocalBuildManifest, LocalBuildManifestSchema } from '@shared/contracts/localBuild';

const logger = scopedLogger('localBuilds.repo');
const INSTANCE_MANIFEST_FILE = 'instance.json';

export const localBuildManifestPath = (dir: string): string =>
  path.join(dir, INSTANCE_MANIFEST_FILE);

// Reads and validates a local build manifest. Returns null (not throws) for a
// missing or malformed manifest so the catalog can skip/flag it without one bad
// build breaking the whole listing.
export const loadLocalBuildManifest = async (dir: string): Promise<LocalBuildManifest | null> => {
  const target = localBuildManifestPath(dir);
  return readJsonValidated(target, LocalBuildManifestSchema, {
    onInvalid: () => logger.warn(`Local build manifest at ${target} is malformed; skipping`),
    onReadError: (error) => logger.warn(`Failed to read local build manifest at ${target}`, error),
  });
};

export const saveLocalBuildManifest = async (
  dir: string,
  manifest: LocalBuildManifest,
): Promise<void> => {
  await writeJsonAtomic(localBuildManifestPath(dir), manifest);
};

export const removeLocalBuildDir = async (dir: string): Promise<void> => {
  await fs.rm(dir, { recursive: true, force: true });
};
