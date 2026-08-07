import { join } from 'node:path';
import { mainConfig } from '@main/config';
import type { ConsoleHub } from '@main/infra/consoleHub';
import { scopedLogger } from '@main/infra/logger';
import { type App, BrowserWindow, shell } from 'electron';
import { createRendererLocation, RENDERER_ENTRY_FILES, safeParseUrl } from './rendererLocations';
import { applyNavigationGuards, withFrameOptions } from './secureWindow';
import { WINDOW_BACKGROUND_COLOR } from './windowColors';

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 624;
const MIN_WIDTH = 1000;
const MIN_HEIGHT = 624;

const logger = scopedLogger('mainWindow');

// Allowlist for shell.openExternal targets. The API host comes from mainConfig
// so dev/prod stay aligned; default posture is deny.
const buildExternalHostAllowlist = (): ReadonlySet<string> => {
  const allowed = new Set<string>();
  const apiUrl = safeParseUrl(mainConfig.apiUrl);
  if (apiUrl?.hostname) allowed.add(apiUrl.hostname.toLowerCase());
  return allowed;
};

const isAllowedExternalUrl = (raw: string, allowlist: ReadonlySet<string>): boolean => {
  const parsed = safeParseUrl(raw);
  if (!parsed) return false;
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  for (const allowed of allowlist) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
};

const buildWindowOptions = (): Electron.BrowserWindowConstructorOptions =>
  withFrameOptions({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow(buildWindowOptions());
  const externalAllowlist = buildExternalHostAllowlist();
  const rendererLocation = createRendererLocation({ entryFile: RENDERER_ENTRY_FILES.Main });

  window.on('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url, externalAllowlist)) {
      void shell.openExternal(url);
    } else {
      logger.info(`Denied external navigation: ${url}`);
    }
    return { action: 'deny' };
  });

  applyNavigationGuards(window, rendererLocation, logger);

  if (rendererLocation.loadUrl) {
    void window.loadURL(rendererLocation.loadUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(rendererLocation.filePath);
  }

  return window;
};

export type MainWindowLifecycleDeps = {
  app: Pick<App, 'on'>;
  consoleHub: Pick<ConsoleHub, 'getWindow'>;
  createWindow: () => BrowserWindow;
  attachNotifier: (window: BrowserWindow) => void;
};

export type MainWindowHolder = {
  get: () => BrowserWindow;
};

// Closing the main window also closes the console (a child surface, not a
// standalone app); macOS `activate` only recreates when the main window is gone
// so a lingering console can't suppress re-open. The reference is read through
// `get` so window-dependent services follow a macOS dock re-open without rewiring.
export const installMainWindowLifecycle = (deps: MainWindowLifecycleDeps): MainWindowHolder => {
  const { app, consoleHub, createWindow, attachNotifier } = deps;

  let current = createWindow();
  attachNotifier(current);

  const bindClose = (window: BrowserWindow): void => {
    window.on('closed', () => {
      consoleHub.getWindow()?.close();
    });
  };
  bindClose(current);

  app.on('second-instance', () => {
    if (current.isDestroyed()) return;
    if (current.isMinimized()) current.restore();
    current.focus();
  });

  app.on('activate', () => {
    if (!current.isDestroyed()) return;
    current = createWindow();
    attachNotifier(current);
    bindClose(current);
  });

  return { get: () => current };
};
