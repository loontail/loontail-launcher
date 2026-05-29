import { i18n } from '@renderer/i18n';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEYS } from '@shared/constants';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { IPC_EVENTS } from '@shared/ipc';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { localizeMinecraftError } from './errorCopy';
import { type ClientRuntimeState, useMinecraftStore } from './store';

// `exactOptionalPropertyTypes` rejects explicit `undefined` values.
const compact = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
};

export const MinecraftEventsListener = (): null => {
  const queryClient = useQueryClient();
  useEffect(() => {
    const patch = useMinecraftStore.getState().patch;
    const offStatus = window.api.on(IPC_EVENTS.minecraftStatus, ({ slug, ...rest }) => {
      patch(slug, compact(rest) as Partial<ClientRuntimeState>);
      if (
        rest.status === InstallStatuses.INSTALLED ||
        rest.status === InstallStatuses.NOT_INSTALLED
      ) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settings.root });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.system.folderSizeRoot });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.system.diskSpaceRoot });
      }
    });
    const offProgress = window.api.on(IPC_EVENTS.minecraftProgress, ({ slug, ...rest }) =>
      patch(slug, compact(rest) as Partial<ClientRuntimeState>),
    );
    const offError = window.api.on(IPC_EVENTS.minecraftError, ({ slug, code, message }) => {
      patch(slug, { error: { code, message } });
      toast.error(localizeMinecraftError(code, message, i18n.t));
    });
    const offLog = window.api.on(IPC_EVENTS.minecraftLog, () => {});
    return () => {
      offStatus();
      offProgress();
      offError();
      offLog();
    };
  }, [queryClient]);
  return null;
};
