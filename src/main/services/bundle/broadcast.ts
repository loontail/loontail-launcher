import type {
  BundleErrorEvent,
  BundleProgressEvent,
  BundleStatusEvent,
} from '@shared/contracts/bundle';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

export const createBundleBroadcaster = (window: BrowserWindow) => ({
  status: (payload: BundleStatusEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.bundleStatus, payload);
  },
  progress: (payload: BundleProgressEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.bundleProgress, payload);
  },
  error: (payload: BundleErrorEvent): void => {
    if (window.isDestroyed()) return;
    window.webContents.send(IPC_EVENTS.bundleError, payload);
  },
});

export type BundleBroadcaster = ReturnType<typeof createBundleBroadcaster>;
