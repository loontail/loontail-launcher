import { consoleHub } from '@main/infra/consoleHub';
import {
  RENDERER_ENTRY_FILES,
  type RendererLocation,
  createRendererLocation,
} from '@main/windows/rendererLocations';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

type TrustedSenderOptions = {
  devServerUrl?: string | null;
  rendererRoot?: string;
};

const isTrustedWindowFrame = (
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
  location: RendererLocation,
): boolean => {
  if (event.sender.id !== window.webContents.id) return false;
  if (event.senderFrame === null) return false;
  return location.isAllowedUrl(event.senderFrame.url);
};

// Deferred console lookup so a freshly reopened window is recognised by its
// current webContents id.
export const createTrustedSenderCheck = (
  mainWindow: BrowserWindow,
  options: TrustedSenderOptions = {},
) => {
  const sharedOptions = {
    ...(options.devServerUrl !== undefined ? { devServerUrl: options.devServerUrl } : {}),
    ...(options.rendererRoot !== undefined ? { rendererRoot: options.rendererRoot } : {}),
  };
  const mainLocation = createRendererLocation({
    entryFile: RENDERER_ENTRY_FILES.Main,
    ...sharedOptions,
  });
  const consoleLocation = createRendererLocation({
    entryFile: RENDERER_ENTRY_FILES.Console,
    ...sharedOptions,
  });

  return (event: IpcMainInvokeEvent): boolean => {
    if (event.senderFrame === null) return false;
    if (event.senderFrame.parent !== null) return false;
    if (isTrustedWindowFrame(event, mainWindow, mainLocation)) return true;
    const consoleWindow = consoleHub.getWindow();
    if (!consoleWindow) return false;
    return isTrustedWindowFrame(event, consoleWindow, consoleLocation);
  };
};
