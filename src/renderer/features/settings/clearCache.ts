import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

// Clears the in-memory query cache (except auth/media) then the on-disk media
// cache. The disk clear is awaited last: only confirm success once it resolves,
// and downgrade to a warning toast when it fails so the user is not told the
// disk cache was cleared when it was not.
export const clearLauncherCache = async (
  queryClient: QueryClient,
  clearMediaCache: () => Promise<unknown>,
  t: TFunction,
): Promise<void> => {
  queryClient.removeQueries({
    predicate: (query) => {
      const [first] = query.queryKey;
      return first !== QUERY_KEY_ROOTS.auth && first !== QUERY_KEY_ROOTS.media;
    },
  });
  try {
    await clearMediaCache();
    toast.success(t('settings.launcher.cacheClearedToast'));
  } catch {
    toast.warn(t('settings.launcher.cacheClearFailedToast'));
  }
};
