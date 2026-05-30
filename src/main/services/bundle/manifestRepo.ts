import fs from 'node:fs/promises';
import path from 'node:path';
import { scopedLogger } from '@main/infra/logger';
import { type LocalManifest, LocalManifestSchema } from '@shared/contracts/bundle';
import { bundleManifestPath } from './paths';

const logger = scopedLogger('bundle.manifest');

export const loadLocalManifest = async (clientFolder: string): Promise<LocalManifest | null> => {
  const target = bundleManifestPath(clientFolder);
  try {
    const raw = await fs.readFile(target, 'utf8');
    const parsed = LocalManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn(`Local bundle manifest at ${target} is malformed; discarding`);
      return null;
    }
    return parsed.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn(`Failed to read local bundle manifest at ${target}`, err);
    return null;
  }
};

export const saveLocalManifest = async (
  clientFolder: string,
  manifest: LocalManifest,
): Promise<void> => {
  const target = bundleManifestPath(clientFolder);
  const tmp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  // Atomic swap — readers see either the previous or the new manifest, never a
  // half-written file.
  await fs.rename(tmp, target);
};

export const clearLocalManifest = async (clientFolder: string): Promise<void> => {
  try {
    await fs.unlink(bundleManifestPath(clientFolder));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to clear local bundle manifest', err);
    }
  }
};
