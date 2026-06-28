import type { CatalogKey } from '@shared/contracts/ids';
import type {
  ClientSettingsOverride,
  LauncherSettings,
  ResolvedClientSettings,
} from '@shared/contracts/settings';
import { joinClientFolder } from './settingsDefaults';

export const resolveClientSettings = (
  settings: LauncherSettings,
  key: CatalogKey | null | undefined,
): ResolvedClientSettings => {
  const override: ClientSettingsOverride =
    key && settings.clients[key] ? settings.clients[key] : {};

  const ram =
    typeof override.memory?.allocatedRamMb === 'number'
      ? override.memory.allocatedRamMb
      : settings.memory.allocatedRamMb;

  const defaultClientFolder = key ? joinClientFolder(settings.storage.clientsFolder, key) : '';
  const clientFolder = override.storage?.clientFolder ?? defaultClientFolder;

  const consoleVal =
    typeof override.launch?.console === 'boolean'
      ? override.launch.console
      : settings.launch.console;
  const fullscreenVal =
    typeof override.launch?.fullscreen === 'boolean'
      ? override.launch.fullscreen
      : settings.launch.fullscreen;

  return {
    memory: { allocatedRamMb: ram },
    storage: { clientsFolder: settings.storage.clientsFolder, clientFolder },
    launch: { console: consoleVal, fullscreen: fullscreenVal },
    runtime: override.runtime ?? null,
    loader: override.loader ?? null,
    diff: {
      ram: ram !== settings.memory.allocatedRamMb,
      folder: clientFolder !== defaultClientFolder,
      console: consoleVal !== settings.launch.console,
      fullscreen: fullscreenVal !== settings.launch.fullscreen,
    },
  };
};
