import type { DiskInfo, PickedFolder } from '@shared/contracts/system';
import { IPC_CHANNELS } from '@shared/ipc';

export const getRamRange = (): Promise<number[]> =>
  window.api.invoke(IPC_CHANNELS.systemGetRamRange, undefined);

export const getDiskSpace = (path: string): Promise<DiskInfo> =>
  window.api.invoke(IPC_CHANNELS.systemGetDiskSpace, path);

export const pickInstallFolder = (): Promise<PickedFolder | null> =>
  window.api.invoke(IPC_CHANNELS.systemPickInstallFolder, undefined);

export const openPath = (path: string): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.systemOpenPath, path);
