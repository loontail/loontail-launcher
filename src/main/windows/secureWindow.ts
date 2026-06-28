import type { Logger } from '@main/infra/logger';
import type { BrowserWindow } from 'electron';
import type { RendererLocation } from './rendererLocations';
import { TITLE_BAR_HEIGHT, TITLE_BAR_OVERLAY_COLOR, TITLE_BAR_SYMBOL_COLOR } from './windowColors';

export const useNativeFrame = (): boolean => process.platform === 'linux';

// Native frame on Linux, hidden frame with the custom title-bar overlay elsewhere.
export const withFrameOptions = (
  base: Electron.BrowserWindowConstructorOptions,
): Electron.BrowserWindowConstructorOptions => {
  if (useNativeFrame()) return { ...base, frame: true };
  return {
    ...base,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: TITLE_BAR_OVERLAY_COLOR,
      symbolColor: TITLE_BAR_SYMBOL_COLOR,
      height: TITLE_BAR_HEIGHT,
    },
  };
};

// Block in-window navigation away from the allowed URL and refuse webview attachment.
export const applyNavigationGuards = (
  window: BrowserWindow,
  rendererLocation: RendererLocation,
  logger: Logger,
): void => {
  window.webContents.on('will-navigate', (event, url) => {
    if (!rendererLocation.isAllowedUrl(url)) {
      event.preventDefault();
      logger.info(`Denied in-window navigation: ${url}`);
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.info('Denied webview attachment');
  });
};
