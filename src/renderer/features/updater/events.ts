import { toast } from '@renderer/shared/ui/Toast';
import { UpdaterStates, type UpdaterStatusEvent } from '@shared/contracts/updater';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { claimAutoCheck, clearUserInitiated, isUserInitiated } from './checkTracking';
import { useUpdaterStore } from './store';

// Squirrel.Windows can't push pings, so the renderer polls while the launcher is open.
const BACKGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Per-session toast-dedup so a background poll doesn't re-toast the same news.
type ToastDedup = { state: string | null; errorMessage: string | null };

export const triggerUpdaterCheck = (): void => {
  void window.api.invoke(IPC_CHANNELS.updaterCheck, undefined);
};

// Skip the IPC roundtrip when a check is in flight, an update is staged, or one fired very recently.
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
  if (!claimAutoCheck(Date.now())) return;
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
      // The button already shows a spinner; a toast would be noise.
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
      // Only confirm "up to date" when the user explicitly asked; background polls stay silent.
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
  // Read the flag before toasting: a terminal state clears it below, and the
  // "up to date" toast must still know the check was user-initiated.
  const wasUserInitiated = isUserInitiated();
  const didToast = toastFor(status, wasUserInitiated, t, dedup);
  if (didToast) dedup.state = status.state;
  if (isFinalState(status.state)) clearUserInitiated();
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
