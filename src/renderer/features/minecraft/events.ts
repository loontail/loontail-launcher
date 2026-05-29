import { i18n } from '@renderer/i18n';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEYS } from '@shared/constants';
import {
  InstallStatuses,
  type MinecraftErrorCode,
  MinecraftErrorCodes,
} from '@shared/contracts/minecraft';
import { IPC_EVENTS } from '@shared/ipc';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { localizeMinecraftError } from './errorCopy';
import { type ClientRuntimeState, useMinecraftStore } from './store';

// Errors a repair can actually fix (missing/corrupt files, missing runtime).
// For these the launch-failure toast offers an inline "Repair" action; other
// errors (no account, network, …) just inform.
const REPAIRABLE_ERROR_CODES: ReadonlySet<MinecraftErrorCode> = new Set([
  MinecraftErrorCodes.NOT_INSTALLED,
  MinecraftErrorCodes.INTEGRITY_ERROR,
  MinecraftErrorCodes.RUNTIME_ERROR,
]);

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
      const text = localizeMinecraftError(code, message, i18n.t);
      if (REPAIRABLE_ERROR_CODES.has(code)) {
        toast.error(text, {
          action: {
            label: i18n.t('clients.repair'),
            onClick: () => {
              void api.repair(slug).catch(() => {});
            },
          },
        });
        return;
      }
      toast.error(text);
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
