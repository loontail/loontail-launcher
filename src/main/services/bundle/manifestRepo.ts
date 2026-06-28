import fs from 'node:fs/promises';
import { readJsonValidated, writeJsonAtomic } from '@main/infra/atomicFile';
import { scopedLogger } from '@main/infra/logger';
import { type LocalManifest, LocalManifestSchema } from '@shared/contracts/bundle';
import { bundleManifestPath } from './paths';

const logger = scopedLogger('bundle.manifest');

export const loadLocalManifest = async (clientFolder: string): Promise<LocalManifest | null> => {
  const target = bundleManifestPath(clientFolder);
  return readJsonValidated(target, LocalManifestSchema, {
    onInvalid: () => logger.warn(`Local bundle manifest at ${target} is malformed; discarding`),
    onReadError: (err) => logger.warn(`Failed to read local bundle manifest at ${target}`, err),
  });
};

export const saveLocalManifest = async (
  clientFolder: string,
  manifest: LocalManifest,
): Promise<void> => {
  const target = bundleManifestPath(clientFolder);
  await writeJsonAtomic(target, manifest, (rmErr) =>
    logger.warn(`Failed to remove tmp ${target}.tmp`, rmErr),
  );
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
