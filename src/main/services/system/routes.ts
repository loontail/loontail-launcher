import {
  ensureDirectory,
  getDiskSpace,
  getFolderSize,
  getRamRange,
  openExternalUrl,
  openPath,
  pickFolderWithSuffix,
} from '@main/infra/system';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { type BrowserWindow, app, clipboard } from 'electron';
import { z } from 'zod';

const PathArgSchema = z.string().min(1);
const PATH_ERROR_MESSAGE = 'path must be a non-empty string';

export const registerSystemRoutes = (router: Router, mainWindow: BrowserWindow): void => {
  router.handle(IPC_CHANNELS.systemGetRamRange, () => getRamRange());

  router.handle(IPC_CHANNELS.systemGetDiskSpace, (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    return getDiskSpace(path);
  });

  router.handle(IPC_CHANNELS.systemGetFolderSize, (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    return getFolderSize(path);
  });

  router.handle(IPC_CHANNELS.systemPickInstallFolder, async () => {
    const picked = await pickFolderWithSuffix(mainWindow, null);
    if (picked) ensureDirectory(picked.path);
    return picked;
  });

  router.handle(IPC_CHANNELS.systemGetDefaultInstallFolder, () => app.getPath('userData'));

  router.handle(IPC_CHANNELS.systemOpenPath, async (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    await openPath(path);
  });

  router.handle(IPC_CHANNELS.systemOpenExternal, async (rawArgs) => {
    const url = parseIpcArgs(PathArgSchema, rawArgs, 'url must be a non-empty string');
    await openExternalUrl(url);
  });

  // Write via the native clipboard module: the renderer's permission handler
  // denies `clipboard-write` by default, so navigator.clipboard.writeText
  // silently fails. Going through main bypasses Chromium's focus / permission
  // gating entirely.
  router.handle(IPC_CHANNELS.systemCopyText, (rawArgs) => {
    const text = parseIpcArgs(z.string(), rawArgs, 'text must be a string');
    clipboard.writeText(text);
  });
};
