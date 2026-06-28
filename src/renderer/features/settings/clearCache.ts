import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

// Await the disk clear last and only confirm success once it resolves, so a
// failed disk clear downgrades to a warning instead of a false success.
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
