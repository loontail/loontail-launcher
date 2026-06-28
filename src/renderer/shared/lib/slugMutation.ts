import type { IpcErrorLocalizer } from '@renderer/shared/lib/errorToast';
import type { CatalogKey } from '@shared/contracts/ids';
import { useMutation } from '@tanstack/react-query';

// Mutation meta read by the global error handler to localize a failed mutation.
export type SlugMutationMeta = {
  errorLocalizer: IpcErrorLocalizer;
};

// Produces a per-feature `useSlugMutation` hook bound to that feature's error
// meta. The returned function is a hook — call it at the top level.
export const makeSlugMutationHook = (meta: SlugMutationMeta) => {
  const useSlugMutation = <T>(fn: (slug: CatalogKey) => Promise<T>) =>
    useMutation({ meta, mutationFn: fn });
  return useSlugMutation;
};
