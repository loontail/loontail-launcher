import type { ClientSlug } from '@shared/contracts/ids';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as api from './api';
import { type BundleRuntimeState, selectBundle, useBundleStore } from './store';

export const useBundleStatus = (slug: ClientSlug | null | undefined): BundleRuntimeState => {
  const state = useBundleStore(selectBundle(slug));

  useEffect(() => {
    if (!slug) return;
    // Live events are source of truth — only seed if the store has no entry yet.
    if (useBundleStore.getState().entries[slug]) return;
    api.checkStatus(slug).then((data) => {
      if (useBundleStore.getState().entries[slug]) return;
      useBundleStore.getState().patch(slug, {
        installed: data.installed,
        signatureMatches: data.signatureMatches,
        progress: data.progress,
      });
    });
  }, [slug]);

  return state;
};

export const useStartBundle = () =>
  useMutation({
    mutationFn: ({ slug, force }: { slug: ClientSlug; force?: boolean }) => api.start(slug, force),
  });

const useSlugMutation = <T>(fn: (slug: ClientSlug) => Promise<T>) =>
  useMutation({ mutationFn: fn });

export const usePauseBundle = () => useSlugMutation(api.pause);
export const useResumeBundle = () => useSlugMutation(api.resume);
export const useCancelBundle = () => useSlugMutation(api.cancel);
