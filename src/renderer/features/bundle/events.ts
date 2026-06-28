import { i18n } from '@renderer/i18n';
import { toast } from '@renderer/shared/ui/Toast';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { IPC_EVENTS } from '@shared/ipc';
import { useEffect } from 'react';
import { localizeBundleError } from './errorCopy';
import { useBundleStore } from './store';

export const BundleEventsListener = (): null => {
  useEffect(() => {
    const patch = useBundleStore.getState().patch;

    const offStatus = window.api.on(IPC_EVENTS.bundleStatus, ({ slug, status }) => {
      patch(slug, {
        status,
        ...(status === BundleSyncStatuses.COMPLETED || status === BundleSyncStatuses.UP_TO_DATE
          ? { installed: true, signatureMatches: true }
          : {}),
      });
    });
    const offProgress = window.api.on(IPC_EVENTS.bundleProgress, (payload) => {
      patch(payload.slug, { status: payload.status, progress: payload });
    });
    const offError = window.api.on(IPC_EVENTS.bundleError, ({ slug, code, message }) => {
      patch(slug, { error: { code, message }, status: BundleSyncStatuses.ERROR });
      toast.error(localizeBundleError(code, message, i18n.t));
    });

    // Uninstall wipes the bundle's local manifest (it lives in the client folder),
    // so mirror that here or the UI stays stuck on "Repair bundle".
    const offMinecraftStatus = window.api.on(IPC_EVENTS.minecraftStatus, ({ slug, status }) => {
      if (status === InstallStatuses.NOT_INSTALLED) useBundleStore.getState().reset(slug);
    });

    return () => {
      offStatus();
      offProgress();
      offError();
      offMinecraftStatus();
    };
  }, []);
  return null;
};
