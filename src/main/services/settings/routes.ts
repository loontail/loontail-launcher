import { directoryHasEntries, pickFolderWithSuffix } from '@main/infra/system';
import { SLUG_REQUIRED_MSG, assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
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

export const registerSettingsRoutes = (
  router: Router,
  getMainWindow: () => BrowserWindow,
): void => {
  router.handle(IPC_CHANNELS.settingsGet, (rawArgs) => {
    assertNoIpcArgs(rawArgs, 'settings.get takes no arguments');
    return getSettings();
  });

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
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED_MSG);
    return clearClientOverride(slug);
  });

  router.handle(IPC_CHANNELS.settingsChooseClientFolder, async (rawArgs) => {
    const slug = parseIpcArgs(ClientSlugSchema, rawArgs, SLUG_REQUIRED_MSG);
    const picked = await pickFolderWithSuffix(getMainWindow(), slug);
    if (!picked) return null;
    const next = setClientOverride(slug, { storage: { clientFolder: picked.path } });
    const installed = await directoryHasEntries(picked.path);
    return { settings: next, installed };
  });
};
