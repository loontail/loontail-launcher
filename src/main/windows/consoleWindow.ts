import { join } from 'node:path';
import type { ConsoleHub } from '@main/infra/consoleHub';
import { scopedLogger } from '@main/infra/logger';
import { BrowserWindow } from 'electron';
import { RENDERER_ENTRY_FILES, createRendererLocation } from './rendererLocations';
import { applyNavigationGuards, withFrameOptions } from './secureWindow';
import { WINDOW_BACKGROUND_COLOR } from './windowColors';

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 720;
const MIN_HEIGHT = 420;

const logger = scopedLogger('consoleWindow');

const buildOptions = (): Electron.BrowserWindowConstructorOptions =>
  withFrameOptions({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Loontail Launcher Console',
    backgroundColor: WINDOW_BACKGROUND_COLOR,
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
  });

export const openConsoleWindow = (consoleHub: ConsoleHub): BrowserWindow => {
  const existing = consoleHub.getWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }

  const window = new BrowserWindow(buildOptions());
  const rendererLocation = createRendererLocation({ entryFile: RENDERER_ENTRY_FILES.Console });

  window.on('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.info(`Denied console window open: ${url}`);
    return { action: 'deny' };
  });

  applyNavigationGuards(window, rendererLocation, logger);

  if (rendererLocation.loadUrl) {
    void window.loadURL(rendererLocation.loadUrl);
  } else {
    void window.loadFile(rendererLocation.filePath);
  }

  consoleHub.attach(window);
  return window;
};
