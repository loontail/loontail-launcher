import type {
  MinecraftErrorEvent,
  MinecraftLogEvent,
  MinecraftProgressEvent,
  MinecraftStatusEvent,
} from '@shared/contracts/minecraft';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

export const createBroadcaster = (window: BrowserWindow) => ({
  status: (payload: MinecraftStatusEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftStatus, payload);
  },
  progress: (payload: MinecraftProgressEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftProgress, payload);
  },
  log: (payload: MinecraftLogEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftLog, payload);
  },
  error: (payload: MinecraftErrorEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftError, payload);
  },
});

export type Broadcaster = ReturnType<typeof createBroadcaster>;
