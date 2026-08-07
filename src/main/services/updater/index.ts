import { scopedLogger } from '@main/infra/logger';
import type { Router } from '@main/ipc/router';
import type { LauncherService } from '@main/services/service';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import { app, autoUpdater, type BrowserWindow } from 'electron';

const logger = scopedLogger('updater');

// Electron's free Squirrel update proxy in front of public GitHub Releases,
// serving electron-builder's Squirrel.Windows artifacts in autoUpdater's format.
const FEED_BASE = 'https://update.electronjs.org';
const REPO_OWNER = 'loontail';
const REPO_NAME = 'minecraft-launcher';

// Squirrel can stall mid-check, wedging `inFlight` and blocking future checks;
// bound the check phase so a stall recovers on its own.
const CHECK_TIMEOUT_MS = 60_000;

export type UpdaterService = LauncherService;

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

  // Claimed synchronously by the check handler and released by the terminal
  // lifecycle events (READY / NOT_AVAILABLE / ERROR) or the watchdog.
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

  // Every terminal outcome must release the slot AND the watchdog together:
  // forget the disarm and a stale 60s timer later broadcasts ERROR over a finished
  // update; forget the flag and every future check is refused as in-flight.
  const settle = (payload: UpdaterStatusEvent): void => {
    disarmWatchdog();
    inFlight = false;
    broadcast(payload);
  };

  const onCheckingForUpdate = (): void => {
    broadcast({ state: UpdaterStates.CHECKING });
  };
  const onUpdateNotAvailable = (): void => {
    settle({ state: UpdaterStates.NOT_AVAILABLE });
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
    settle({ state: UpdaterStates.READY, version: releaseName || app.getVersion() });
  };
  const onError = (error: Error): void => {
    logger.error('autoUpdater error', error);
    settle({ state: UpdaterStates.ERROR, message: error.message });
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

      router.handleNoArgs(IPC_CHANNELS.updaterInstall, () => {
        if (!isSquirrelEnabled()) return;
        autoUpdater.quitAndInstall();
      });

      router.handleNoArgs(IPC_CHANNELS.updaterCheck, () => {
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
          // Claim the slot before the call, not from the async
          // `checking-for-update` event: Squirrel emits that a tick later, so two
          // invokes in the same tick would both pass the gate above and spawn two
          // Update.exe cycles.
          inFlight = true;
          armWatchdog();
          autoUpdater.checkForUpdates();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('autoUpdater check failed', err);
          settle({ state: UpdaterStates.ERROR, message: err.message });
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
