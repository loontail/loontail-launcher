import { makeBroadcaster } from '@main/infra/broadcaster';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

export const createBroadcaster = (getWindow: () => BrowserWindow) =>
  makeBroadcaster(getWindow, {
    status: IPC_EVENTS.minecraftStatus,
    progress: IPC_EVENTS.minecraftProgress,
    error: IPC_EVENTS.minecraftError,
  });

export type Broadcaster = ReturnType<typeof createBroadcaster>;
