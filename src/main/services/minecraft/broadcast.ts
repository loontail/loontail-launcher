import type {
  MinecraftErrorEvent,
  MinecraftProgressEvent,
  MinecraftStatusEvent,
} from '@shared/contracts/minecraft';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

// `getWindow` resolves the live main window on each send: it can be recreated
// (macOS dock re-open after the window was closed) and a captured reference
// would broadcast into the destroyed original.
export const createBroadcaster = (getWindow: () => BrowserWindow) => ({
  status: (payload: MinecraftStatusEvent): void => {
    const window = getWindow();
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftStatus, payload);
  },
  progress: (payload: MinecraftProgressEvent): void => {
    const window = getWindow();
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftProgress, payload);
  },
  error: (payload: MinecraftErrorEvent): void => {
    const window = getWindow();
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.minecraftError, payload);
  },
});

export type Broadcaster = ReturnType<typeof createBroadcaster>;
