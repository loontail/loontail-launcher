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
      // `sandbox: false` matches how the working reference console (elixir-app)
      // configures its window. With the sandbox enabled, contextBridge IPC
      // dispatch for high-frequency push batches (`console.lines`) was
      // unreliable in background BrowserWindows — events silently dropped
      // even though `console.state` (single object pushes) still arrived.
      // Disabling the sandbox is safe here: the preload is the only script
      // path, and it only exposes the launcher's own contextBridge API.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium aggressively throttles timers / RAF in occluded background
      // BrowserWindows. Disable so the console keeps drawing while the user
      // has the launcher focused or Minecraft fullscreen.
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

/**
 * Reveal the singleton console window. Creates it on first call,
 * focuses an existing instance otherwise. Pushes are wired through
 * `consoleHub.attach()` so logs flow even before the renderer mounts —
 * the renderer pulls its backlog via `console.getInitial`.
 */
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
