import { i18n } from '@renderer/i18n';
import { makeKeyMutationHook } from '@renderer/shared/lib/keyMutation';
import { makeSeededStatusHook } from '@renderer/shared/lib/makeSeededStatusHook';
import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import type { CatalogKey } from '@shared/contracts/ids';
import type { IpcError } from '@shared/ipc';
import { useMutation } from '@tanstack/react-query';
import * as api from './api';
import { localizeBundleError } from './errorCopy';
import { selectBundle, useBundleStore } from './store';

const bundleMutationMeta = {
  errorLocalizer: (error: IpcError) => localizeBundleError(error.code, error.message, i18n.t),
};

const useKeyMutation = makeKeyMutationHook(bundleMutationMeta);

export const useBundleStatus = makeSeededStatusHook({
  store: { useStore: useBundleStore, selectEntry: selectBundle },
  seeder: createStatusSeeder(api.getStatus),
  toPatch: (data) => ({
    installed: data.installed,
    signatureMatches: data.signatureMatches,
    progress: data.progress,
  }),
  label: 'bundle',
});

export const useStartBundle = () =>
  useMutation({
    meta: bundleMutationMeta,
    mutationFn: ({ key, force }: { key: CatalogKey; force?: boolean }) => api.start(key, force),
  });

export const usePauseBundle = () => useKeyMutation(api.pause);
export const useResumeBundle = () => useKeyMutation(api.resume);
export const useCancelBundle = () => useKeyMutation(api.cancel);
