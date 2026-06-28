import { toast } from '@renderer/shared/ui/Toast';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { useUpdaterStore } from './store';

// 30 min background poll. Squirrel.Windows can't push pings, so the renderer
// drives recurring checks while the launcher is open.
const BACKGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Minimum gap between automatic checks (startup / focus / interval). Stops
// burst focus events from spamming update.electronjs.org. User-clicked checks
// bypass this — they go through `triggerUpdaterCheck` directly.
const AUTO_CHECK_DEDUPE_MS = 5_000;

// Mirrors the literal the main-side watchdog broadcasts on a stalled check
// (updater/index.ts). A timeout ERROR is the renderer's signal that the
// user's pending success confirmation is now stale and must be dropped.
const UPDATER_TIMEOUT_MESSAGE = 'Update check timed out';

type CheckTrackingStore = {
  lastAutoCheckAt: number;
  userInitiatedCheck: boolean;
  markUserInitiated: () => void;
  clearUserInitiated: () => void;
  // Records the attempt and reports whether the dedupe window allows it. Kept
  // in the store (not module scope) so it survives no instance and resets
  // cleanly between mounts.
  claimAutoCheck: (now: number) => boolean;
  reset: () => void;
};

export const useUpdaterCheckTracking = create<CheckTrackingStore>((set, get) => ({
  lastAutoCheckAt: Number.NEGATIVE_INFINITY,
  userInitiatedCheck: false,
  markUserInitiated: () => set({ userInitiatedCheck: true }),
  clearUserInitiated: () => set({ userInitiatedCheck: false }),
  claimAutoCheck: (now) => {
    if (now - get().lastAutoCheckAt < AUTO_CHECK_DEDUPE_MS) return false;
    set({ lastAutoCheckAt: now });
    return true;
  },
  reset: () => set({ lastAutoCheckAt: Number.NEGATIVE_INFINITY, userInitiatedCheck: false }),
}));

// Per-session toast-dedup so the same news isn't re-toasted on every background
// poll, but is fresh again in a new launcher session.
type ToastDedup = { state: string | null; errorMessage: string | null };

export const markUserInitiatedCheck = (): void => {
  useUpdaterCheckTracking.getState().markUserInitiated();
};

export const triggerUpdaterCheck = (): void => {
  void window.api.invoke(IPC_CHANNELS.updaterCheck, undefined);
};

// Automatic checks (startup / focus / interval) skip if a check is already
// in flight, an update is already staged, or another auto-check fired very
// recently. The main process has its own in-flight guard too — this just
// avoids the IPC roundtrip in the common case.
const triggerAutoCheck = (): void => {
  const current = useUpdaterStore.getState().value;
  if (
    current &&
    (current.state === UpdaterStates.CHECKING ||
      current.state === UpdaterStates.AVAILABLE ||
      current.state === UpdaterStates.READY)
  ) {
    return;
  }
  if (!useUpdaterCheckTracking.getState().claimAutoCheck(Date.now())) return;
  triggerUpdaterCheck();
};

const isFinalState = (state: string): boolean =>
  state === UpdaterStates.NOT_AVAILABLE ||
  state === UpdaterStates.READY ||
  state === UpdaterStates.ERROR;

const isWatchdogTimeout = (status: UpdaterStatusEvent): boolean =>
  status.state === UpdaterStates.ERROR && status.message === UPDATER_TIMEOUT_MESSAGE;

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

export const handleUpdaterStatus = (
  status: UpdaterStatusEvent,
  t: TFunction,
  dedup: ToastDedup,
): void => {
  const tracking = useUpdaterCheckTracking.getState();
  const wasUserInitiated = tracking.userInitiatedCheck;
  const didToast = toastFor(status, wasUserInitiated, t, dedup);
  if (didToast) dedup.state = status.state;
  // A timeout ERROR is a terminal state, so the second clause is redundant for
  // correctness; it documents the alignment with the main-side watchdog and
  // keeps the intent explicit if isFinalState ever narrows.
  if (isFinalState(status.state) || isWatchdogTimeout(status)) {
    tracking.clearUserInitiated();
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
      handleUpdaterStatus(status, t, dedup);
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
