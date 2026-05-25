import type { DiskInfo, FolderSize, PickedFolder } from '@shared/contracts/system';
import { IPC_CHANNELS } from '@shared/ipc';

export const getRamRange = (): Promise<number[]> =>
  window.api.invoke(IPC_CHANNELS.systemGetRamRange, undefined);

export const getDiskSpace = (path: string): Promise<DiskInfo> =>
  window.api.invoke(IPC_CHANNELS.systemGetDiskSpace, path);

export const getFolderSize = (path: string): Promise<FolderSize> =>
  window.api.invoke(IPC_CHANNELS.systemGetFolderSize, path);

export const pickInstallFolder = (): Promise<PickedFolder | null> =>
  window.api.invoke(IPC_CHANNELS.systemPickInstallFolder, undefined);

export const getDefaultInstallFolder = (): Promise<string> =>
  window.api.invoke(IPC_CHANNELS.systemGetDefaultInstallFolder, undefined);

export const openPath = (path: string): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.systemOpenPath, path);
