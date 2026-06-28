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
      // sandbox:false is a documented workaround: contextBridge push batches
      // (`console.lines`) are silently dropped in sandboxed background
      // BrowserWindows, and there is no test that would catch that runtime
      // regression, so flipping to sandbox:true is not a safe minimal change.
      //
      // The residual blast radius (a renderer compromise here is unsandboxed) is
      // contained by two invariants that MUST hold:
      //   1. IPC is scoped to CONSOLE_TRUSTED_CHANNELS (4 console.* channels);
      //      the trusted-sender check denies every other handler (auth/launch/
      //      settings/system) to this window.
      //   2. The console renderer renders all (attacker-influenceable) Minecraft
      //      stdout/stderr as TEXT nodes only — never dangerouslySetInnerHTML or
      //      unsanitized markdown — so attacker output cannot become DOM/script.
      // contextIsolation stays on and the preload exposes only the typed API.
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
