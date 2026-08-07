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

    // The installed/signatureMatches reset lives in the store's clearErrorStatuses
    // config, which createRuntimeStore applies to every status patch.
    const offStatus = window.api.on(IPC_EVENTS.bundleStatus, ({ key, status }) => {
      patch(key, { status });
    });
    const offProgress = window.api.on(IPC_EVENTS.bundleProgress, (payload) => {
      patch(payload.key, { status: payload.status, progress: payload });
    });
    const offError = window.api.on(IPC_EVENTS.bundleError, ({ key, code, message }) => {
      patch(key, { error: { code, message }, status: BundleSyncStatuses.ERROR });
      toast.error(localizeBundleError(code, message, i18n.t));
    });

    // Uninstall wipes the bundle's local manifest (it lives in the client folder),
    // so mirror that here or the UI stays stuck on "Repair bundle".
    const offMinecraftStatus = window.api.on(IPC_EVENTS.minecraftStatus, ({ key, status }) => {
      if (status === InstallStatuses.NOT_INSTALLED) useBundleStore.getState().reset(key);
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
