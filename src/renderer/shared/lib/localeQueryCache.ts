import { QUERY_KEY_ROOTS, QUERY_KEYS } from '@shared/constants';
import type { QueryClient } from '@tanstack/react-query';

const CATALOG_LOCALE_INDEX = QUERY_KEYS.catalog.list('locale').indexOf('locale');

// Catalog payloads are keyed per locale and kept for the full gcTime window (and
// dehydrated to localStorage), so a language switch would otherwise leave the
// previous locale's copy behind. Evict every locale except the active one —
// removing the active key would also drop the fetch the remounting grid awaits.
export const evictInactiveLocaleQueries = (
  queryClient: QueryClient,
  activeLocale: string,
): void => {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === QUERY_KEY_ROOTS.catalog &&
      query.queryKey[CATALOG_LOCALE_INDEX] !== activeLocale,
  });
};
