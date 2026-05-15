import { directoryHasEntries, pickFolderWithSuffix } from '@main/infra/system';
import type { Router } from '@main/ipc/router';
import {
  clearClientOverride,
  getSettings,
  patchLauncherSettings,
  setClientOverride,
} from '@main/services/settings/settings';
import { ERROR_CODES } from '@shared/constants';
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
    const parsed = PatchLauncherSettingsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw {
        code: ERROR_CODES.SettingsInvalidPayload,
        message: 'Invalid launcher patch',
        details: parsed.error.format(),
      };
    }
    return patchLauncherSettings(parsed.data);
  });

  router.handle(IPC_CHANNELS.settingsSetClientOverride, (rawArgs) => {
    const parsed = SetClientOverridePayloadSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw {
        code: ERROR_CODES.SettingsInvalidPayload,
        message: 'Invalid client override',
        details: parsed.error.format(),
      };
    }
    return setClientOverride(parsed.data.bundleSlug, parsed.data.patch);
  });

  router.handle(IPC_CHANNELS.settingsClearClientOverrides, (rawArgs) => {
    const parsed = BundleSlugSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw {
        code: ERROR_CODES.SettingsInvalidPayload,
        message: 'bundleSlug must be a non-empty string',
      };
    }
    return clearClientOverride(parsed.data);
  });

  router.handle(IPC_CHANNELS.settingsChooseClientFolder, async (rawArgs) => {
    const parsed = BundleSlugSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw {
        code: ERROR_CODES.SettingsInvalidPayload,
        message: 'bundleSlug must be a non-empty string',
      };
    }
    const bundleSlug = parsed.data;
    const picked = await pickFolderWithSuffix(mainWindow, bundleSlug);
    if (!picked) return null;
    const next = setClientOverride(bundleSlug, { storage: { clientFolder: picked.path } });
    const installed = directoryHasEntries(picked.path);
    return { settings: next, installed };
  });
};
