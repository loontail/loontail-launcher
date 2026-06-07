import fs from 'node:fs/promises';
import path from 'node:path';
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
  try {
    const raw = await fs.readFile(target, 'utf8');
    const parsed = InstanceManifestSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      logger.warn(`Instance manifest at ${target} is malformed; skipping`);
      return null;
    }
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn(`Failed to read instance manifest at ${target}`, error);
    return null;
  }
};

// Atomic write (tmp + rename, ENOENT-safe rm first) — matches the bundle/install
// manifest writers, which is the codebase's Windows-safe persistence pattern.
export const saveInstanceManifest = async (
  dir: string,
  manifest: InstanceManifest,
): Promise<void> => {
  const target = instanceManifestPath(dir);
  const temporary = `${target}.tmp`;
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

export const removeInstanceDir = async (dir: string): Promise<void> => {
  await fs.rm(dir, { recursive: true, force: true });
};
