import { toast } from '@renderer/shared/ui/Toast';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStore } from './store';

// 30 min background poll. Squirrel.Windows can't push pings, so the renderer
// drives recurring checks while the launcher is open.
const BACKGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Minimum gap between automatic checks (startup / focus / interval). Stops
// burst focus events from spamming update.electronjs.org. User-clicked checks
// bypass this — they go through `triggerUpdaterCheck` directly.
const AUTO_CHECK_DEDUPE_MS = 5_000;
let lastAutoCheckAt = 0;

// Module state survives re-renders but resets on page reload — exactly right
// for "don't re-toast the same news on every background poll, but do toast it
// fresh in a new launcher session."
let userInitiatedCheck = false;
let lastToastedState: string | null = null;
let lastToastedErrorMessage: string | null = null;

export const markUserInitiatedCheck = (): void => {
  userInitiatedCheck = true;
};

export const triggerUpdaterCheck = (): void => {
  void window.api.invoke(IPC_CHANNELS.updaterCheck, undefined);
};

// Automatic checks (startup / focus / interval) skip if a check is already
// in flight, an update is already staged, or another auto-check fired very
// recently. The main process has its own in-flight guard too — this just
// avoids the IPC roundtrip in the common case.
const triggerAutoCheck = (): void => {
  const now = Date.now();
  if (now - lastAutoCheckAt < AUTO_CHECK_DEDUPE_MS) return;
  const current = useUpdaterStore.getState().value;
  if (
    current &&
    (current.state === UpdaterStates.CHECKING ||
      current.state === UpdaterStates.AVAILABLE ||
      current.state === UpdaterStates.DOWNLOADING ||
      current.state === UpdaterStates.READY)
  ) {
    return;
  }
  lastAutoCheckAt = now;
  triggerUpdaterCheck();
};

const isFinalState = (state: string): boolean =>
  state === UpdaterStates.NOT_AVAILABLE ||
  state === UpdaterStates.READY ||
  state === UpdaterStates.ERROR;

const toastFor = (status: UpdaterStatusEvent, wasUserInitiated: boolean, t: TFunction): boolean => {
  switch (status.state) {
    case UpdaterStates.CHECKING:
      // Button shows a spinner — an extra toast would just be noise.
      return false;
    case UpdaterStates.DOWNLOADING:
      // Squirrel.Windows doesn't surface progress; nothing useful to toast.
      return false;
    case UpdaterStates.AVAILABLE:
      if (lastToastedState === status.state) return false;
      toast.info(
        status.version
          ? t('updater.toast.available', { version: status.version })
          : t('updater.toast.availableNoVersion'),
      );
      return true;
    case UpdaterStates.NOT_AVAILABLE:
      // Background polls stay silent — only confirm "up to date" when the user
      // explicitly asked.
      if (!wasUserInitiated) return false;
      toast.success(t('updater.toast.notAvailable'));
      return true;
    case UpdaterStates.READY:
      if (lastToastedState === status.state) return false;
      toast.success(
        status.version
          ? t('updater.toast.ready', { version: status.version })
          : t('updater.toast.readyNoVersion'),
      );
      return true;
    case UpdaterStates.ERROR: {
      const sameAsLast =
        lastToastedState === status.state && lastToastedErrorMessage === status.message;
      if (sameAsLast && !wasUserInitiated) return false;
      toast.error(t('updater.toast.error', { message: status.message }));
      lastToastedErrorMessage = status.message;
      return true;
    }
    default:
      return false;
  }
};

// Mount once at app root: feeds the global store and translates transitions
// into toasts. AppBar badge + LauncherSection both read from the store.
export const UpdaterEventsListener = (): null => {
  const { t } = useTranslation();
  useEffect(() => {
    const setStatus = useUpdaterStore.getState().setValue;
    return window.api.on(IPC_EVENTS.updaterStatus, (status) => {
      setStatus(status);
      const wasUserInitiated = userInitiatedCheck;
      const didToast = toastFor(status, wasUserInitiated, t);
      if (didToast) lastToastedState = status.state;
      if (isFinalState(status.state)) userInitiatedCheck = false;
    });
  }, [t]);
  return null;
};

// Kick off a check on launcher startup, on every window focus, and on a slow
// interval while the app is open. Mounted alongside UpdaterEventsListener.
export const UpdaterAutoCheck = (): null => {
  useEffect(() => {
    triggerAutoCheck();
    const intervalId = setInterval(triggerAutoCheck, BACKGROUND_CHECK_INTERVAL_MS);
    const onFocus = (): void => triggerAutoCheck();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return null;
};
