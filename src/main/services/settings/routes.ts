import { directoryHasEntries, pickFolderWithSuffix } from '@main/infra/system';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import {
  clearClientOverride,
  getSettings,
  patchLauncherSettings,
  setClientOverride,
} from '@main/services/settings/settings';
import { BundleSlugSchema } from '@shared/contracts/ids';
import {
  PatchLauncherSettingsSchema,
  SetClientOverridePayloadSchema,
} from '@shared/contracts/settings';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

export const registerSettingsRoutes = (router: Router, mainWindow: BrowserWindow): void => {
  router.handle(IPC_CHANNELS.settingsGet, () => getSettings());

  router.handle(IPC_CHANNELS.settingsSetLauncher, (rawArgs) => {
    const patch = parseIpcArgs(PatchLauncherSettingsSchema, rawArgs, 'Invalid launcher patch');
    return patchLauncherSettings(patch);
  });

  router.handle(IPC_CHANNELS.settingsSetClientOverride, (rawArgs) => {
    const payload = parseIpcArgs(
      SetClientOverridePayloadSchema,
      rawArgs,
      'Invalid client override',
    );
    return setClientOverride(payload.bundleSlug, payload.patch);
  });

  router.handle(IPC_CHANNELS.settingsClearClientOverrides, (rawArgs) => {
    const bundleSlug = parseIpcArgs(
      BundleSlugSchema,
      rawArgs,
      'bundleSlug must be a non-empty string',
    );
    return clearClientOverride(bundleSlug);
  });

  router.handle(IPC_CHANNELS.settingsChooseClientFolder, async (rawArgs) => {
    const bundleSlug = parseIpcArgs(
      BundleSlugSchema,
      rawArgs,
      'bundleSlug must be a non-empty string',
    );
    const picked = await pickFolderWithSuffix(mainWindow, bundleSlug);
    if (!picked) return null;
    const next = setClientOverride(bundleSlug, { storage: { clientFolder: picked.path } });
    const installed = directoryHasEntries(picked.path);
    return { settings: next, installed };
  });
};
