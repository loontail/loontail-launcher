import type { ClientSlug } from '@shared/contracts/ids';
import type { InstallStatus } from '@shared/contracts/minecraft';
import type { LoaderChoice } from '@shared/contracts/settings';
import { IPC_CHANNELS } from '@shared/ipc';

export const getStatus = (slug: ClientSlug): Promise<{ status: InstallStatus; paused: boolean }> =>
  window.api.invoke(IPC_CHANNELS.minecraftGetStatus, slug);

export const install = (slug: ClientSlug, loader?: LoaderChoice): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftInstall, { slug, ...(loader ? { loader } : {}) });

export const pauseInstall = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftPause, slug);

export const resumeInstall = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftResume, slug);

export const cancelInstall = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftCancel, slug);

export const repair = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftRepair, slug);

export const uninstall = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftUninstall, slug);

export const launch = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftLaunch, slug);

export const stop = (slug: ClientSlug): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.minecraftStop, slug);
