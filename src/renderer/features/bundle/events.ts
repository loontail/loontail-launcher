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

    // Bundle local manifest lives inside the client folder, so an uninstall
    // wipes it transparently. Mirror that here so the UI doesn't stay stuck on
    // a "Repair bundle" state after the user deletes the client.
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
