import { consoleHub } from '@main/infra/consoleHub';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

// Deferred console lookup so a freshly reopened window is recognised by its
// current webContents id.
export const createTrustedSenderCheck =
  (mainWindow: BrowserWindow) =>
  (event: IpcMainInvokeEvent): boolean => {
    if (event.senderFrame === null) return false;
    if (event.senderFrame.parent !== null) return false;
    if (event.sender.id === mainWindow.webContents.id) return true;
    const consoleWindow = consoleHub.getWindow();
    if (consoleWindow && event.sender.id === consoleWindow.webContents.id) return true;
    return false;
  };
