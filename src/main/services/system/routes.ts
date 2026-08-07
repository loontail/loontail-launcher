import { writeClipboardText } from '@main/infra/clipboard';
import { scopedLogger } from '@main/infra/logger';
import {
  ensureDirectory,
  getDiskSpace,
  getFolderSize,
  getRamRange,
  isPathUnderAllowedRoots,
  openPath,
  pickFolderWithSuffix,
} from '@main/infra/system';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { getSettings } from '@main/services/settings/settings';
import { type DiskInfo, type FolderSize, SystemErrorCodes } from '@shared/contracts/system';
import { IPC_CHANNELS } from '@shared/ipc';
import { app, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { SystemError } from './errors';

const PathArgSchema = z.string().min(1);
const PATH_ERROR_MESSAGE = 'path must be a non-empty string';

const logger = scopedLogger('system.routes');

// Both probes are expensive (a whole-tree walk; a PowerShell/`df` spawn) and the
// Setup and Settings screens ask for the same path from several components, so
// identical concurrent requests share one result instead of each starting its own
// walk or spawning its own process. Keyed by the requested path verbatim, so the
// shared answer always describes exactly what the caller asked for, and claimed
// synchronously (the allowlist check runs inside the shared task).
const coalesce = <T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> => {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
};

export const registerSystemRoutes = (router: Router, getMainWindow: () => BrowserWindow): void => {
  // The folder the user chose through the native dialog this session. It is not
  // launcher-owned yet (Setup/Settings read free space and folder size before
  // saving it), but an OS file dialog is a first-party choice, so the latest pick
  // stays addressable for those two read-only probes — and only for them: a dialog
  // can return a drive root, and putting it in the openPath allowlist would let a
  // compromised renderer hand any file under it to the OS default handler.
  let lastPickedRoot: string | null = null;

  const folderSizeInFlight = new Map<string, Promise<FolderSize>>();
  const diskSpaceInFlight = new Map<string, Promise<DiskInfo>>();

  const getLauncherOwnedRoots = (): string[] => {
    const settings = getSettings();
    const clientRoots: string[] = [];
    for (const override of Object.values(settings.clients)) {
      if (!override) continue;
      if (override.storage?.clientFolder) clientRoots.push(override.storage.clientFolder);
      if (override.runtime?.path) clientRoots.push(override.runtime.path);
    }

    return [app.getPath('userData'), settings.storage.clientsFolder, ...clientRoots].filter(
      Boolean,
    );
  };

  const getProbeRoots = (): string[] => {
    const roots = getLauncherOwnedRoots();
    return lastPickedRoot ? [...roots, lastPickedRoot] : roots;
  };

  // Every renderer-supplied path is bound to a launcher-owned root: unbounded,
  // `getFolderSize('C:\\Users')` enumerates and sizes any readable directory.
  const isProbeAllowed = async (path: string): Promise<boolean> => {
    if (await isPathUnderAllowedRoots(path, getProbeRoots())) return true;
    logger.warn('Refused a path outside launcher-owned roots', { path });
    return false;
  };

  router.handleNoArgs(IPC_CHANNELS.systemGetRamRange, () => {
    return getRamRange();
  });

  router.handle(IPC_CHANNELS.systemGetDiskSpace, (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    return coalesce(diskSpaceInFlight, path, async () => {
      if (!(await isProbeAllowed(path))) {
        throw new SystemError(SystemErrorCodes.PATH_NOT_ALLOWED, 'Path is not launcher-owned');
      }
      const info = await getDiskSpace(path);
      if (!info) {
        throw new SystemError(SystemErrorCodes.DISK_PROBE_FAILED, 'Could not read disk space');
      }
      return info;
    });
  });

  // A resolved `bytes: null` is a domain answer (nothing measurable there yet, e.g.
  // a build folder before its first install) — only a refusal rejects.
  router.handle(IPC_CHANNELS.systemGetFolderSize, (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    return coalesce(folderSizeInFlight, path, async () => {
      if (!(await isProbeAllowed(path))) {
        throw new SystemError(SystemErrorCodes.PATH_NOT_ALLOWED, 'Path is not launcher-owned');
      }
      return getFolderSize(path);
    });
  });

  router.handleNoArgs(IPC_CHANNELS.systemPickInstallFolder, async () => {
    const picked = await pickFolderWithSuffix(getMainWindow(), null);
    if (picked) {
      await ensureDirectory(picked.path);
      lastPickedRoot = picked.path;
    }
    return picked;
  });

  router.handleNoArgs(IPC_CHANNELS.systemGetDefaultInstallFolder, () => {
    return app.getPath('userData');
  });

  router.handle(IPC_CHANNELS.systemOpenPath, async (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    await openPath(path, getLauncherOwnedRoots());
  });

  router.handle(IPC_CHANNELS.systemCopyText, (rawArgs) => {
    const text = parseIpcArgs(z.string(), rawArgs, 'text must be a string');
    writeClipboardText(text);
  });
};
