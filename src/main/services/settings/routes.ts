import { directoryHasEntries, pickFolderWithSuffix } from '@main/infra/system';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import {
  clearClientOverride,
  getSettings,
  patchLauncherSettings,
  setClientOverride,
} from '@main/services/settings/settings';
import { ClientSlugSchema } from '@shared/contracts/ids';
import {
  PatchLauncherSettingsSchema,
  SetClientOverridePayloadSchema,
} from '@shared/contracts/settings';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

const SLUG_REQUIRED = 'slug must be a non-empty string';

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
    return setClientOverride(payload.slug, payload.patch);
  });

  router.handle(IPC_CHANNELS.settingsClearClientOverrides, (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    return clearClientOverride(slug);
  });

  router.handle(IPC_CHANNELS.settingsChooseClientFolder, async (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED);
    const picked = await pickFolderWithSuffix(mainWindow, slug);
    if (!picked) return null;
    const next = setClientOverride(slug, { storage: { clientFolder: picked.path } });
    const installed = await directoryHasEntries(picked.path);
    return { settings: next, installed };
  });
};
