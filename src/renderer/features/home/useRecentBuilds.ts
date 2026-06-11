import { useCatalog } from '@renderer/features/catalog';
import { QUERY_KEYS } from '@shared/constants';
import type { CatalogItem } from '@shared/contracts/catalog';
import { selectRecent } from '@shared/domain/recent';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getLastPlayed } from './api';

const DEFAULT_RECENT_LIMIT = 12;

export type UseRecentBuildsResult = {
  recent: CatalogItem[];
  isPending: boolean;
};

// Combines the persisted played-at map with the live catalog into a
// most-recent-first list for the Home dashboard. Refetches the played-at map on
// window focus; the MinecraftEventsListener also invalidates its key on RUNNING.
export const useRecentBuilds = (limit: number = DEFAULT_RECENT_LIMIT): UseRecentBuildsResult => {
  const catalog = useCatalog();
  const playedQuery = useQuery({
    queryKey: QUERY_KEYS.history.lastPlayed,
    queryFn: getLastPlayed,
    refetchOnWindowFocus: true,
  });
  const recent = useMemo(
    () => selectRecent(playedQuery.data ?? {}, catalog.items, limit),
    [playedQuery.data, catalog.items, limit],
  );
  return { recent, isPending: catalog.isPending || playedQuery.isPending };
};
