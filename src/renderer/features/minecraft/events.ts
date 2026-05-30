import { i18n } from '@renderer/i18n';
import { toast } from '@renderer/shared/ui/Toast';
import {
  type ToastAction,
  type ToastVariant,
  ToastVariants,
} from '@renderer/shared/ui/Toast/toast';
import { QUERY_KEYS } from '@shared/constants';
import type { ClientSlug } from '@shared/contracts/ids';
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
// For these we show a calm "heads up" prompt offering a Repair, not a red error —
// the game is still installed, something is just out of date. Other errors
// (no account, network, …) stay as informational error toasts.
export const REPAIRABLE_ERROR_CODES: ReadonlySet<MinecraftErrorCode> = new Set([
  MinecraftErrorCodes.NOT_INSTALLED,
  MinecraftErrorCodes.INTEGRITY_ERROR,
  MinecraftErrorCodes.RUNTIME_ERROR,
]);

export type MinecraftErrorToast = {
  readonly variant: ToastVariant;
  readonly message: string;
  readonly action?: ToastAction;
};

// A repairable code becomes a warn toast with a friendly "run a repair?" prompt
// and an inline Repair action (no raw error text); everything else stays a plain
// error toast carrying the localized error message.
export const buildMinecraftErrorToast = (
  code: MinecraftErrorCode,
  slug: ClientSlug,
  message: string,
): MinecraftErrorToast => {
  if (REPAIRABLE_ERROR_CODES.has(code)) {
    return {
      variant: ToastVariants.WARN,
      message: i18n.t('clients.repairOffer'),
      action: {
        label: i18n.t('clients.repair'),
        onClick: () => {
          void api.repair(slug).catch(() => {});
        },
      },
    };
  }
  return {
    variant: ToastVariants.ERROR,
    message: localizeMinecraftError(code, message, i18n.t),
  };
};

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
      const built = buildMinecraftErrorToast(code, slug, message);
      toast[built.variant](built.message, built.action ? { action: built.action } : undefined);
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
