import { i18n } from '@renderer/i18n';
import type { CatalogKey } from '@shared/contracts/ids';
import type { IpcError } from '@shared/ipc';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { localizeBundleError } from './errorCopy';
import { statusSeeder } from './statusSeeder';
import { type BundleRuntimeState, selectBundle, useBundleStore } from './store';

const bundleMutationMeta = {
  errorLocalizer: (error: IpcError) => localizeBundleError(error.code, error.message, i18n.t),
};

export const useBundleStatus = (slug: CatalogKey | null | undefined): BundleRuntimeState => {
  const state = useBundleStore(selectBundle(slug));

  useEffect(() => {
    if (!slug) return;
    // Live events are source of truth — only seed if the store has no entry yet.
    if (useBundleStore.getState().entries[slug]) return;
    void statusSeeder
      .seedStatus(slug)
      .then((data) => {
        if (useBundleStore.getState().entries[slug]) return;
        useBundleStore.getState().patch(slug, {
          installed: data.installed,
          signatureMatches: data.signatureMatches,
          progress: data.progress,
        });
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: best-effort seed — main logger unreachable from renderer
        console.warn('[bundle] failed to seed status', error);
      });
  }, [slug]);

  return state;
};

export const useStartBundle = () =>
  useMutation({
    meta: bundleMutationMeta,
    mutationFn: ({ slug, force }: { slug: CatalogKey; force?: boolean }) => api.start(slug, force),
  });

const useSlugMutation = <T>(fn: (slug: CatalogKey) => Promise<T>) =>
  useMutation({ meta: bundleMutationMeta, mutationFn: fn });

export const usePauseBundle = () => useSlugMutation(api.pause);
export const useResumeBundle = () => useSlugMutation(api.resume);
export const useCancelBundle = () => useSlugMutation(api.cancel);
