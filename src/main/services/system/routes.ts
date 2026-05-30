import {
  ensureDirectory,
  getDiskSpace,
  getFolderSize,
  getRamRange,
  openPath,
  pickFolderWithSuffix,
} from '@main/infra/system';
import { assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { getSettings } from '@main/services/settings/settings';
import { IPC_CHANNELS } from '@shared/ipc';
import { type BrowserWindow, app, clipboard } from 'electron';
import { z } from 'zod';

const PathArgSchema = z.string().min(1);
const PATH_ERROR_MESSAGE = 'path must be a non-empty string';

const getOpenPathAllowedRoots = (): string[] => {
  const settings = getSettings();
  const clientRoots: string[] = [];
  for (const override of Object.values(settings.clients)) {
    if (!override) continue;
    if (override.storage?.clientFolder) clientRoots.push(override.storage.clientFolder);
    if (override.runtime?.path) clientRoots.push(override.runtime.path);
  }

  return [app.getPath('userData'), settings.storage.clientsFolder, ...clientRoots].filter(Boolean);
};

export const registerSystemRoutes = (router: Router, mainWindow: BrowserWindow): void => {
  router.handle(IPC_CHANNELS.systemGetRamRange, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'system.getRamRange takes no arguments');
    return getRamRange();
  });

  router.handle(IPC_CHANNELS.systemGetDiskSpace, (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    return getDiskSpace(path);
  });

  router.handle(IPC_CHANNELS.systemGetFolderSize, (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    return getFolderSize(path);
  });

  router.handle(IPC_CHANNELS.systemPickInstallFolder, async (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'system.pickInstallFolder takes no arguments');
    const picked = await pickFolderWithSuffix(mainWindow, null);
    if (picked) await ensureDirectory(picked.path);
    return picked;
  });

  router.handle(IPC_CHANNELS.systemGetDefaultInstallFolder, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'system.getDefaultInstallFolder takes no arguments');
    return app.getPath('userData');
  });

  router.handle(IPC_CHANNELS.systemOpenPath, async (rawArgs) => {
    const path = parseIpcArgs(PathArgSchema, rawArgs, PATH_ERROR_MESSAGE);
    await openPath(path, getOpenPathAllowedRoots());
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
