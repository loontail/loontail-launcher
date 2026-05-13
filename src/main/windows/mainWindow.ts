import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
const BACKGROUND_COLOR = '#0f0f10';
const TITLE_BAR_HEIGHT = 40;
const TITLE_BAR_OVERLAY_COLOR = 'rgba(0, 0, 0, 0)';
const TITLE_BAR_SYMBOL_COLOR = '#a3a3a3';

const useNativeFrame = (): boolean => process.platform === 'linux';

const buildWindowOptions = (): Electron.BrowserWindowConstructorOptions => {
  const base: Electron.BrowserWindowConstructorOptions = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: BACKGROUND_COLOR,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };

  if (useNativeFrame()) {
    return { ...base, frame: true };
  }

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

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow(buildWindowOptions());

  window.on('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
};
