import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

export const createTrustedSenderCheck =
  (window: BrowserWindow) =>
  (event: IpcMainInvokeEvent): boolean => {
    if (event.sender.id !== window.webContents.id) return false;
    if (event.senderFrame === null) return false;
    return event.senderFrame.parent === null;
  };
