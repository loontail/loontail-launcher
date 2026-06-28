import type {
  BundleErrorEvent,
  BundleProgressEvent,
  BundleStatusEvent,
} from '@shared/contracts/bundle';
import { IPC_EVENTS, emit } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

// `getWindow` resolves the live main window on each send: it can be recreated
// (macOS dock re-open after the window was closed) and a captured reference
// would broadcast into the destroyed original.
export const createBundleBroadcaster = (getWindow: () => BrowserWindow) => ({
  status: (payload: BundleStatusEvent): void => {
    emit(getWindow(), IPC_EVENTS.bundleStatus, payload);
  },
  progress: (payload: BundleProgressEvent): void => {
    emit(getWindow(), IPC_EVENTS.bundleProgress, payload);
  },
  error: (payload: BundleErrorEvent): void => {
    emit(getWindow(), IPC_EVENTS.bundleError, payload);
  },
});

export type BundleBroadcaster = ReturnType<typeof createBundleBroadcaster>;
