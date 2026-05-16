import { consoleHub } from '@main/infra/consoleHub';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

/**
 * Accept IPC traffic only from a known top-level frame in either the
 * main launcher window or the singleton console window. The console
 * lookup is deferred (the window is created on demand) so a fresh
 * webContents id is recognised each time it reopens.
 */
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
