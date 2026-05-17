import { toast } from '@renderer/shared/ui/Toast';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStore } from './store';

// 30 min background poll. Squirrel.Windows can't push pings, so the renderer
// drives recurring checks once the launcher is open.
const BACKGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

// User-initiated checks toast on every transition (including "up to date");
// background checks only toast when something actionable happens. The flag is
// shared via module state because the IPC roundtrip detaches the click from
// the eventual status broadcast.
let userInitiatedCheck = false;
let lastToastedState: string | null = null;

export const markUserInitiatedCheck = (): void => {
  userInitiatedCheck = true;
};

export const triggerUpdaterCheck = (): void => {
  void window.api.invoke(IPC_CHANNELS.updaterCheck, undefined);
};

const isTerminalState = (state: string): boolean =>
  state === UpdaterStates.NOT_AVAILABLE ||
  state === UpdaterStates.READY ||
  state === UpdaterStates.ERROR;

const emitToastFor = (status: UpdaterStatusEvent, t: TFunction): void => {
  // De-dupe so a stream of identical broadcasts (e.g. repeated background polls
  // landing on "not-available") doesn't pile toasts on top of each other.
  if (status.state === lastToastedState && status.state !== UpdaterStates.ERROR) return;
  switch (status.state) {
    case UpdaterStates.CHECKING:
      if (userInitiatedCheck) toast.info(t('updater.toast.checking'));
      break;
    case UpdaterStates.AVAILABLE:
      toast.info(
        status.version
          ? t('updater.toast.available', { version: status.version })
          : t('updater.toast.availableNoVersion'),
      );
      break;
    case UpdaterStates.NOT_AVAILABLE:
      if (userInitiatedCheck) toast.success(t('updater.toast.notAvailable'));
      break;
    case UpdaterStates.READY:
      toast.success(
        status.version
          ? t('updater.toast.ready', { version: status.version })
          : t('updater.toast.readyNoVersion'),
      );
      break;
    case UpdaterStates.ERROR:
      toast.error(t('updater.toast.error', { message: status.message }));
      break;
  }
  lastToastedState = status.state;
  if (isTerminalState(status.state)) userInitiatedCheck = false;
};

// Mount once at app root: subscribes to updater.status pushes, feeds the
// global store, and translates transitions into toasts. AppBar badge +
// LauncherSection both read from the store.
export const UpdaterEventsListener = (): null => {
  const { t } = useTranslation();
  useEffect(() => {
    const setStatus = useUpdaterStore.getState().setValue;
    return window.api.on(IPC_EVENTS.updaterStatus, (status) => {
      setStatus(status);
      emitToastFor(status, t);
    });
  }, [t]);
  return null;
};

// Kick off an initial check on launcher startup, then poll in the background
// while the app is open. Mounted alongside UpdaterEventsListener.
export const UpdaterAutoCheck = (): null => {
  useEffect(() => {
    triggerUpdaterCheck();
    const id = setInterval(triggerUpdaterCheck, BACKGROUND_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return null;
};
