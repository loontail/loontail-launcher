import { makeBroadcaster } from '@main/infra/broadcaster';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

export const createBundleBroadcaster = (getWindow: () => BrowserWindow) =>
  makeBroadcaster(getWindow, {
    status: IPC_EVENTS.bundleStatus,
    progress: IPC_EVENTS.bundleProgress,
    error: IPC_EVENTS.bundleError,
  });

export type BundleBroadcaster = ReturnType<typeof createBundleBroadcaster>;
