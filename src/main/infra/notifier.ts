import { type NotificationPayload, NotificationVariants } from '@shared/contracts/notification';
import { IPC_EVENTS, emit } from '@shared/ipc';
import type { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

// Wire once from bootstrap; the renderer picks up `app.notification` events via
// NotificationsListener and dispatches into the toast system.
export const attachNotifier = (window: BrowserWindow): void => {
  mainWindow = window;
};

const send = (payload: NotificationPayload): void => {
  emit(mainWindow, IPC_EVENTS.appNotification, payload);
};

export const notify = {
  success: (message: string) => send({ variant: NotificationVariants.SUCCESS, message }),
  error: (message: string) => send({ variant: NotificationVariants.ERROR, message }),
  info: (message: string) => send({ variant: NotificationVariants.INFO, message }),
  warn: (message: string) => send({ variant: NotificationVariants.WARN, message }),
};
