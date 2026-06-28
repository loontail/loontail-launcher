import { directoryHasEntries, pickFolderWithSuffix } from '@main/infra/system';
import { KEY_REQUIRED_MSG, assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import {
  clearClientOverride,
  getSettings,
  patchLauncherSettings,
  setClientOverride,
} from '@main/services/settings/settings';
import { catalogKeyToRefValue } from '@shared/contracts/catalog';
import { CatalogKeySchema } from '@shared/contracts/ids';
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
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    return clearClientOverride(key);
  });

  router.handle(IPC_CHANNELS.settingsChooseClientFolder, async (rawArgs) => {
    const key = parseIpcArgs(CatalogKeySchema, rawArgs, KEY_REQUIRED_MSG);
    // The folder suffix is the bare ref value, never the CatalogKey: `:` is an
    // illegal Windows filename char. A malformed key is impossible here (schema
    // validated), so the fallback only guards the type.
    const suffix = catalogKeyToRefValue(key) ?? (key as string);
    const picked = await pickFolderWithSuffix(getMainWindow(), suffix);
    if (!picked) return null;
    const next = setClientOverride(key, { storage: { clientFolder: picked.path } });
    const installed = await directoryHasEntries(picked.path);
    return { settings: next, installed };
  });
};
