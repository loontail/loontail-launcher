import fs from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '@main/infra/errorMessage';
import { clearLocalManifest } from '@main/services/bundle/manifestRepo';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import type { ManagerEnv } from './env';
import { ManagerError } from './errors';
import { clearTargetInstallManifest } from './installManifest';
import { OpKinds } from './ops';
import { isAnythingInstalled } from './runtimeState';

// Guard before recursive rm: reject anything not strictly under clientsRoot (no
// `..` escapes, no absolute paths).
export const isUnderClientsRoot = (folder: string, clientsRoot: string): boolean => {
  if (!folder || !clientsRoot) return false;
  const rel = path.relative(clientsRoot, folder);
  if (rel === '') return false;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
};

export const runUninstall = async (
  env: ManagerEnv,
  slug: CatalogKey,
  folder: string,
  clientsRoot: string,
): Promise<void> => {
  if (!isUnderClientsRoot(folder, clientsRoot)) {
    throw new ManagerError(MinecraftErrorCodes.UNKNOWN, 'Refusing to delete suspicious path');
  }
  env.ops.set(slug, { kind: OpKinds.UNINSTALL });
  env.emitStatus({ slug, status: InstallStatuses.UNINSTALLING, paused: false });
  try {
    await fs.rm(folder, { recursive: true, force: true });
    await clearTargetInstallManifest(folder);
    env.clearRuntimeOverride(slug);
    env.forgeProcessorCache.clear();
    env.emitStatus({ slug, status: InstallStatuses.NOT_INSTALLED, paused: false });
  } catch (error) {
    env.logger.error(`[${slug}] uninstall failed`, error);
    // Best-effort second pass on just the markers isAnythingInstalled checks, so a
    // file lock elsewhere in the tree doesn't leave an ERROR + INSTALLED flicker.
    await Promise.allSettled([
      fs.rm(path.join(folder, 'versions'), { recursive: true, force: true }),
      fs.rm(path.join(folder, 'runtime'), { recursive: true, force: true }),
      clearTargetInstallManifest(folder),
      clearLocalManifest(folder),
    ]);
    if (!(await isAnythingInstalled(folder))) {
      env.logger.warn(`[${slug}] uninstall: residual files remain but markers are gone`);
      env.clearRuntimeOverride(slug);
      env.forgeProcessorCache.clear();
      env.emitStatus({ slug, status: InstallStatuses.NOT_INSTALLED, paused: false });
    } else {
      env.emitError(slug, MinecraftErrorCodes.UNINSTALL_LOCKED, errorMessage(error));
      env.emitStatus({ slug, status: InstallStatuses.ERROR, paused: false });
    }
  } finally {
    env.ops.delete(slug);
  }
};
