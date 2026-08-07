import { join } from 'node:path';
import type { ConsoleHub } from '@main/infra/consoleHub';
import { scopedLogger } from '@main/infra/logger';
import { BrowserWindow } from 'electron';
import { createRendererLocation, RENDERER_ENTRY_FILES } from './rendererLocations';
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
      // sandbox:false works around contextBridge push batches (`console.lines`)
      // being silently dropped in sandboxed background BrowserWindows. The
      // unsandboxed blast radius is contained by two invariants that MUST hold:
      //   1. IPC is scoped to CONSOLE_TRUSTED_CHANNELS; the trusted-sender check
      //      denies every other handler to this window.
      //   2. The renderer renders attacker-influenceable stdout/stderr as TEXT
      //      nodes only — never innerHTML/unsanitized markdown.
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
