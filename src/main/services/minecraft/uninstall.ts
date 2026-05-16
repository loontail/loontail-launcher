import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import type { ManagerEnv } from './env';
import { ManagerError, errorMessage } from './errors';
import { OpKinds } from './ops';

// Belt-and-braces guard before recursive rm. The folder must be the result of
// the user's "Pick client folder" flow — i.e. somewhere under the configured
// clientsRoot, not a parent of it. Anything ascending out of clientsRoot via
// `..` or escaping by absolute path is rejected.
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
  slug: ClientSlug,
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
    env.clearRuntimeOverride(slug);
    env.emitStatus({ slug, status: InstallStatuses.NOT_INSTALLED, paused: false });
  } catch (error) {
    env.logger.error(`[${slug}] uninstall failed`, error);
    env.emitError(slug, MinecraftErrorCodes.UNKNOWN, errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.ERROR, paused: false });
  } finally {
    env.ops.delete(slug);
  }
};
