import type { CatalogKey } from '@shared/contracts/ids';
import type { InstallStatus } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { IPC_CHANNELS } from '@shared/ipc';

export const getStatus = (key: CatalogKey): Promise<{ status: InstallStatus; paused: boolean }> =>
  window.api.invoke(IPC_CHANNELS.minecraftGetStatus, key);

export const install = (key: CatalogKey, loader?: LoaderChoice): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftInstall, { slug: key, ...(loader ? { loader } : {}) });

export const pauseInstall = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftPause, key);

export const resumeInstall = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftResume, key);

export const cancelInstall = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftCancel, key);

export const repair = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftRepair, key);

export const uninstall = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftUninstall, key);

export const launch = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftLaunch, key);

export const stop = (key: CatalogKey): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftStop, key);
