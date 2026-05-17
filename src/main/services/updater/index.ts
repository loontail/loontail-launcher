import { scopedLogger } from '@main/infra/logger';
import type { Router } from '@main/ipc/router';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import { type BrowserWindow, app } from 'electron';
import { autoUpdater } from 'electron-updater';

const logger = scopedLogger('updater');

export type UpdaterService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

// Local event-to-payload map for the events we listen to. electron-updater
// exposes the event name union but not a typed payload map, so we encode the
// payloads here and validate them via the explicit handler signatures below.
type EventMap = {
  'checking-for-update': () => void;
  'update-available': (info: { version: string }) => void;
  'update-not-available': () => void;
  'download-progress': (info: { percent: number }) => void;
  'update-downloaded': (info: { version: string }) => void;
  'update-cancelled': () => void;
  error: (error: Error) => void;
};

type Unsubscribe = () => void;

const bind = <Event extends keyof EventMap>(
  event: Event,
  handler: EventMap[Event],
): Unsubscribe => {
  // electron-updater's `on` is typed permissively (`event: UpdaterEvents`)
  // and accepts any handler. We narrow at the call site.
  autoUpdater.on(event, handler as never);
  return () => {
    autoUpdater.removeListener(event, handler as never);
  };
};

export const createUpdaterService = (router: Router, mainWindow: BrowserWindow): UpdaterService => {
  const broadcast = (payload: UpdaterStatusEvent): void => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_EVENTS.updaterStatus, payload);
  };

  let checking = false;
  const unsubscribers: Unsubscribe[] = [];

  return {
    init: async () => {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.logger = logger;

      unsubscribers.push(
        bind('checking-for-update', () => broadcast({ state: UpdaterStates.CHECKING })),
        bind('update-available', (info) =>
          broadcast({ state: UpdaterStates.AVAILABLE, version: info.version }),
        ),
        bind('update-not-available', () => broadcast({ state: UpdaterStates.NOT_AVAILABLE })),
        bind('download-progress', (info) =>
          broadcast({ state: UpdaterStates.DOWNLOADING, percent: info.percent }),
        ),
        bind('update-downloaded', (info) =>
          broadcast({ state: UpdaterStates.READY, version: info.version }),
        ),
        bind('update-cancelled', () => broadcast({ state: UpdaterStates.NOT_AVAILABLE })),
        bind('error', (error) => {
          logger.error('autoUpdater error', error);
          broadcast({ state: UpdaterStates.ERROR, message: error.message });
        }),
      );

      router.handle(IPC_CHANNELS.updaterInstall, () => {
        // Restart + apply the staged update. autoUpdater drives app.quit()
        // itself, so the renderer doesn't need to confirm.
        if (!app.isPackaged) return;
        autoUpdater.quitAndInstall();
      });

      router.handle(IPC_CHANNELS.updaterCheck, async () => {
        // electron-updater is a no-op in dev — `checkForUpdates` would throw
        // on a missing dev-app-update.yml. Tell the renderer instead.
        if (!app.isPackaged) {
          broadcast({ state: UpdaterStates.NOT_AVAILABLE });
          return;
        }
        // Guard against the user mashing the Check button: autoUpdater queues
        // concurrent calls but surfaces them as confusing duplicate events.
        if (checking) return;
        checking = true;
        try {
          await autoUpdater.checkForUpdates();
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('autoUpdater check failed', err);
          broadcast({ state: UpdaterStates.ERROR, message: err.message });
        } finally {
          checking = false;
        }
      });
    },
    dispose: async () => {
      while (unsubscribers.length > 0) {
        const off = unsubscribers.pop();
        off?.();
      }
    },
  };
};
