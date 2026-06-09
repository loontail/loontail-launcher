import type { ConsoleHub } from '@main/infra/consoleHub';
import {
  RENDERER_ENTRY_FILES,
  type RendererLocation,
  createRendererLocation,
} from '@main/windows/rendererLocations';
import { CONSOLE_TRUSTED_CHANNELS, type IpcContract } from '@shared/ipc';
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

// `getMainWindow` is resolved per-call so a recreated window (macOS dock
// re-open) is recognised by its current webContents id rather than the
// destroyed original's — otherwise every IPC from the new window is rejected.
export const createTrustedSenderCheck = (
  getMainWindow: () => BrowserWindow,
  consoleHub: ConsoleHub,
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

  return (event: IpcMainInvokeEvent, channel: keyof IpcContract): boolean => {
    if (event.senderFrame === null) return false;
    if (event.senderFrame.parent !== null) return false;
    if (isTrustedWindowFrame(event, getMainWindow(), mainLocation)) return true;
    // The console window runs unsandboxed, so scope it to an explicit channel
    // allowlist; it must never be able to invoke auth/launch/settings/system
    // handlers.
    if (!CONSOLE_TRUSTED_CHANNELS.has(channel)) return false;
    const consoleWindow = consoleHub.getWindow();
    if (!consoleWindow) return false;
    return isTrustedWindowFrame(event, consoleWindow, consoleLocation);
  };
};
