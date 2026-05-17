import { type NotificationPayload, NotificationVariants } from '@shared/contracts/notification';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

// Wire once from bootstrap; the renderer picks up `app.notification` events via
// NotificationsListener and dispatches into the toast system.
export const attachNotifier = (window: BrowserWindow): void => {
  mainWindow = window;
};

const send = (payload: NotificationPayload): void => {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  try {
    window.webContents.send(IPC_EVENTS.appNotification, payload);
  } catch {
    /* renderer torn down between checks — drop the push */
  }
};

export const notify = {
  success: (message: string) => send({ variant: NotificationVariants.SUCCESS, message }),
  error: (message: string) => send({ variant: NotificationVariants.ERROR, message }),
  info: (message: string) => send({ variant: NotificationVariants.INFO, message }),
  warn: (message: string) => send({ variant: NotificationVariants.WARN, message }),
};
