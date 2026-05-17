import { join } from 'node:path';
import { consoleHub } from '@main/infra/consoleHub';
import { BrowserWindow } from 'electron';

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 720;
const MIN_HEIGHT = 420;
const BACKGROUND_COLOR = '#212121';
const TITLE_BAR_HEIGHT = 40;
const TITLE_BAR_OVERLAY_COLOR = 'rgba(0, 0, 0, 0)';
const TITLE_BAR_SYMBOL_COLOR = '#a3a3a3';

const useNativeFrame = (): boolean => process.platform === 'linux';

const buildOptions = (): Electron.BrowserWindowConstructorOptions => {
  const base: Electron.BrowserWindowConstructorOptions = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Loontail Launcher Console',
    backgroundColor: BACKGROUND_COLOR,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox:false — contextBridge push batches (`console.lines`) silently
      // dropped in sandboxed background BrowserWindows. Safe here: the preload
      // is the only script path and only exposes our typed contextBridge API.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep drawing while the launcher is focused or Minecraft is fullscreen.
      backgroundThrottling: false,
    },
  };
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

export const openConsoleWindow = (): BrowserWindow => {
  const existing = consoleHub.getWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }

  const window = new BrowserWindow(buildOptions());

  window.on('ready-to-show', () => window.show());

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}/console.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/console.html'));
  }

  consoleHub.attach(window);
  return window;
};
