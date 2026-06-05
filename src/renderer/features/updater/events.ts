import { toast } from '@renderer/shared/ui/Toast';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';
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

// Shared between markUserInitiatedCheck (called from the settings button) and
// triggerAutoCheck; module scope is intentional so both reach the same flag.
let userInitiatedCheck = false;

// Per-session toast-dedup so the same news isn't re-toasted on every background
// poll, but is fresh again in a new launcher session.
type ToastDedup = { state: string | null; errorMessage: string | null };

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

const toastFor = (
  status: UpdaterStatusEvent,
  wasUserInitiated: boolean,
  t: TFunction,
  dedup: ToastDedup,
): boolean => {
  switch (status.state) {
    case UpdaterStates.CHECKING:
      // Button shows a spinner — an extra toast would just be noise.
      return false;
    case UpdaterStates.DOWNLOADING:
      // Squirrel.Windows doesn't surface progress; nothing useful to toast.
      return false;
    case UpdaterStates.AVAILABLE:
      if (dedup.state === status.state) return false;
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
      if (dedup.state === status.state) return false;
      toast.success(
        status.version
          ? t('updater.toast.ready', { version: status.version })
          : t('updater.toast.readyNoVersion'),
      );
      return true;
    case UpdaterStates.ERROR: {
      const sameAsLast = dedup.state === status.state && dedup.errorMessage === status.message;
      if (sameAsLast && !wasUserInitiated) return false;
      toast.error(t('updater.toast.error', { message: status.message }));
      dedup.errorMessage = status.message;
      return true;
    }
    default:
      return false;
  }
};

export const UpdaterEventsListener = (): null => {
  const { t } = useTranslation();
  const dedupRef = useRef<ToastDedup>({ state: null, errorMessage: null });
  useEffect(() => {
    const setStatus = useUpdaterStore.getState().setValue;
    const dedup = dedupRef.current;
    return window.api.on(IPC_EVENTS.updaterStatus, (status) => {
      setStatus(status);
      const wasUserInitiated = userInitiatedCheck;
      const didToast = toastFor(status, wasUserInitiated, t, dedup);
      if (didToast) dedup.state = status.state;
      if (isFinalState(status.state)) userInitiatedCheck = false;
    });
  }, [t]);
  return null;
};

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
