import { scopedLogger } from '@main/infra/logger';
import { assertNoIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import { type BrowserWindow, app, autoUpdater } from 'electron';

const logger = scopedLogger('updater');

// Electron's free Squirrel update proxy in front of public GitHub Releases,
// serving electron-builder's Squirrel.Windows artifacts in autoUpdater's format.
const FEED_BASE = 'https://update.electronjs.org';
const REPO_OWNER = 'loontail';
const REPO_NAME = 'minecraft-launcher';

// Squirrel can stall mid-check, wedging `inFlight` and blocking future checks;
// bound the check phase so a stall recovers on its own.
const CHECK_TIMEOUT_MS = 60_000;

export type UpdaterService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

const isSquirrelEnabled = (): boolean => app.isPackaged && process.platform === 'win32';

export const createUpdaterService = (
  router: Router,
  getMainWindow: () => BrowserWindow,
): UpdaterService => {
  const broadcast = (payload: UpdaterStatusEvent): void => {
    const mainWindow = getMainWindow();
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_EVENTS.updaterStatus, payload);
  };

  // Driven by autoUpdater lifecycle events (not the synchronous checkForUpdates()
  // return): in-flight from CHECKING through READY or terminal NOT_AVAILABLE/ERROR.
  let inFlight = false;
  let registered = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const disarmWatchdog = (): void => {
    if (watchdog === null) return;
    clearTimeout(watchdog);
    watchdog = null;
  };
  const armWatchdog = (): void => {
    disarmWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      if (!inFlight) return;
      logger.warn('autoUpdater check timed out; resetting in-flight state');
      inFlight = false;
      broadcast({ state: UpdaterStates.ERROR, message: 'Update check timed out' });
    }, CHECK_TIMEOUT_MS);
    watchdog.unref();
  };

  const onCheckingForUpdate = (): void => {
    inFlight = true;
    broadcast({ state: UpdaterStates.CHECKING });
  };
  const onUpdateNotAvailable = (): void => {
    disarmWatchdog();
    inFlight = false;
    broadcast({ state: UpdaterStates.NOT_AVAILABLE });
  };
  // Squirrel exposes no progress event or version until `update-downloaded`, so
  // emit AVAILABLE (no version) for a "downloading…" UI. Disarm the watchdog: the
  // download stays in-flight until READY/ERROR and the check timer would false-fire.
  const onUpdateAvailable = (): void => {
    disarmWatchdog();
    broadcast({ state: UpdaterStates.AVAILABLE });
  };
  const onUpdateDownloaded = (
    _event: unknown,
    _releaseNotes: string,
    releaseName: string,
  ): void => {
    disarmWatchdog();
    inFlight = false;
    broadcast({ state: UpdaterStates.READY, version: releaseName || app.getVersion() });
  };
  const onError = (error: Error): void => {
    logger.error('autoUpdater error', error);
    disarmWatchdog();
    inFlight = false;
    broadcast({ state: UpdaterStates.ERROR, message: error.message });
  };

  return {
    init: async () => {
      if (isSquirrelEnabled()) {
        const feed = `${FEED_BASE}/${REPO_OWNER}/${REPO_NAME}/${process.platform}-${process.arch}/${app.getVersion()}`;
        try {
          autoUpdater.setFeedURL({ url: feed });
          autoUpdater.on('checking-for-update', onCheckingForUpdate);
          autoUpdater.on('update-not-available', onUpdateNotAvailable);
          autoUpdater.on('update-available', onUpdateAvailable);
          autoUpdater.on('update-downloaded', onUpdateDownloaded);
          autoUpdater.on('error', onError);
          registered = true;
        } catch (error) {
          logger.warn('autoUpdater setup failed; updates disabled', error);
        }
      } else {
        logger.info('autoUpdater disabled (not a packaged Windows build)');
      }

      router.handle(IPC_CHANNELS.updaterInstall, (rawArgs) => {
        assertNoIpcArgs(rawArgs, 'updater.install takes no arguments');
        if (!isSquirrelEnabled()) return;
        autoUpdater.quitAndInstall();
      });

      router.handle(IPC_CHANNELS.updaterCheck, async (rawArgs) => {
        assertNoIpcArgs(rawArgs, 'updater.check takes no arguments');
        // Gate on `registered`, not `isSquirrelEnabled()`: setFeedURL can throw,
        // leaving listeners unattached. Ack with a terminal event, don't drop it.
        if (!registered) {
          broadcast({ state: UpdaterStates.NOT_AVAILABLE });
          return;
        }
        if (inFlight) {
          logger.info('updaterCheck: skipped (already in flight)');
          return;
        }
        try {
          logger.info('updaterCheck: invoking autoUpdater.checkForUpdates()');
          armWatchdog();
          autoUpdater.checkForUpdates();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('autoUpdater check failed', err);
          disarmWatchdog();
          inFlight = false;
          broadcast({ state: UpdaterStates.ERROR, message: err.message });
        }
      });
    },
    dispose: async () => {
      disarmWatchdog();
      if (!registered) return;
      autoUpdater.removeListener('checking-for-update', onCheckingForUpdate);
      autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
      autoUpdater.removeListener('update-available', onUpdateAvailable);
      autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
      autoUpdater.removeListener('error', onError);
    },
  };
};
