import {
  ensureDirectory,
  getDiskSpace,
  getRamRange,
  openPath,
  pickFolderWithSuffix,
} from '@main/infra/system';
import type { Router } from '@main/ipc/router';
import { ERROR_CODES, LAUNCHER_DIRNAME } from '@shared/constants';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

export const registerSystemRoutes = (router: Router, mainWindow: BrowserWindow): void => {
  router.handle(IPC_CHANNELS.systemGetRamRange, () => getRamRange());

  router.handle(IPC_CHANNELS.systemGetDiskSpace, (rawArgs) => {
    if (typeof rawArgs !== 'string') {
      throw {
        code: ERROR_CODES.IpcInvalidArgs,
        message: 'path must be a string',
      };
    }
    return getDiskSpace(rawArgs);
  });

  router.handle(IPC_CHANNELS.systemPickInstallFolder, async () => {
    const picked = await pickFolderWithSuffix(mainWindow, LAUNCHER_DIRNAME);
    if (picked) ensureDirectory(picked.path);
    return picked;
  });

  router.handle(IPC_CHANNELS.systemOpenPath, async (rawArgs) => {
    if (typeof rawArgs !== 'string') {
      throw {
        code: ERROR_CODES.IpcInvalidArgs,
        message: 'path must be a string',
      };
    }
    await openPath(rawArgs);
  });
};
