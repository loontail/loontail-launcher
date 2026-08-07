import type { IpcErrorLocalizer } from '@renderer/shared/lib/errorToast';
import type { CatalogKey } from '@shared/contracts/ids';
import { useMutation } from '@tanstack/react-query';

// Mutation meta read by the global error handler to localize a failed mutation.
export type KeyMutationMeta = {
  errorLocalizer: IpcErrorLocalizer;
};

// Produces a per-feature `useKeyMutation` hook bound to that feature's error
// meta. The returned function is a hook — call it at the top level.
export const makeKeyMutationHook = (meta: KeyMutationMeta) => {
  const useKeyMutation = <T>(fn: (key: CatalogKey) => Promise<T>) =>
    useMutation({ meta, mutationFn: fn });
  return useKeyMutation;
};
