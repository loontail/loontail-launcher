import type { IpcErrorLocalizer } from '@renderer/shared/lib/errorToast';
import type { CatalogKey } from '@shared/contracts/ids';
import { useMutation } from '@tanstack/react-query';

// Mutation meta carrying the feature's error localizer; the global mutation
// error handler (queryClient) reads `meta.errorLocalizer` to render a human
// message for a failed mutation.
export type SlugMutationMeta = {
  errorLocalizer: IpcErrorLocalizer;
};

// A factory producing a per-feature `useSlugMutation` hook bound to that
// feature's error meta. The feature instantiates it once with its localizer,
// then wraps each per-action api fn — collapsing the verbatim
// `useMutation({meta, mutationFn})` boilerplate the minecraft and bundle hooks
// each open-coded. The returned function is a hook (call it at the top level).
export const makeSlugMutationHook = (meta: SlugMutationMeta) => {
  const useSlugMutation = <T>(fn: (slug: CatalogKey) => Promise<T>) =>
    useMutation({ meta, mutationFn: fn });
  return useSlugMutation;
};
