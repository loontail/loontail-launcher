import { scopedLogger } from '@main/infra/logger';
import { assertNoIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import { type BrowserWindow, app, autoUpdater } from 'electron';

const logger = scopedLogger('updater');

// `update.electronjs.org` is the Electron team's free Squirrel update proxy
// in front of public GitHub Releases. It reads the `RELEASES` + `*-full.nupkg`
// that `electron-builder` publishes for the Squirrel.Windows target and serves
// them in the format `electron.autoUpdater` expects.
const FEED_BASE = 'https://update.electronjs.org';
const REPO_OWNER = 'loontail';
const REPO_NAME = 'minecraft-launcher';

export type UpdaterService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

const isSquirrelEnabled = (): boolean => app.isPackaged && process.platform === 'win32';

export const createUpdaterService = (router: Router, mainWindow: BrowserWindow): UpdaterService => {
  const broadcast = (payload: UpdaterStatusEvent): void => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_EVENTS.updaterStatus, payload);
  };

  // `inFlight` is driven by autoUpdater lifecycle events, not the
  // (synchronous) checkForUpdates() return — the actual check happens
  // asynchronously via Squirrel events. We stay in-flight from CHECKING
  // through download completion (READY) or terminal NOT_AVAILABLE / ERROR.
  let inFlight = false;
  let registered = false;

  const onCheckingForUpdate = (): void => {
    inFlight = true;
    broadcast({ state: UpdaterStates.CHECKING });
  };
  const onUpdateNotAvailable = (): void => {
    inFlight = false;
    broadcast({ state: UpdaterStates.NOT_AVAILABLE });
  };
  // Squirrel's autoUpdater doesn't surface a separate progress event; the
  // download is opaque until `update-downloaded` fires. Emit AVAILABLE so the
  // UI can show "downloading…" while Squirrel pulls the .nupkg in the
  // background. Stay in-flight until READY (or ERROR).
  const onUpdateAvailable = (): void => broadcast({ state: UpdaterStates.AVAILABLE, version: '' });
  const onUpdateDownloaded = (
    _event: unknown,
    _releaseNotes: string,
    releaseName: string,
  ): void => {
    inFlight = false;
    broadcast({ state: UpdaterStates.READY, version: releaseName || app.getVersion() });
  };
  const onError = (error: Error): void => {
    logger.error('autoUpdater error', error);
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
        if (!isSquirrelEnabled()) {
          broadcast({ state: UpdaterStates.NOT_AVAILABLE });
          return;
        }
        if (inFlight) {
          logger.info('updaterCheck: skipped (already in flight)');
          return;
        }
        try {
          logger.info('updaterCheck: invoking autoUpdater.checkForUpdates()');
          autoUpdater.checkForUpdates();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('autoUpdater check failed', err);
          inFlight = false;
          broadcast({ state: UpdaterStates.ERROR, message: err.message });
        }
      });
    },
    dispose: async () => {
      if (!registered) return;
      autoUpdater.removeListener('checking-for-update', onCheckingForUpdate);
      autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
      autoUpdater.removeListener('update-available', onUpdateAvailable);
      autoUpdater.removeListener('update-downloaded', onUpdateDownloaded);
      autoUpdater.removeListener('error', onError);
    },
  };
};
