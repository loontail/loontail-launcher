import { QUERY_KEYS } from '@shared/constants';
import type { ServerStatus } from '@shared/contracts/serverStatus';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getServerStatuses } from './api';

const STATUS_STALE_TIME_MS = 30_000;

export const useServerStatuses = (
  addresses: readonly string[],
): {
  isPending: boolean;
  isError: boolean;
  byAddress: ReadonlyMap<string, ServerStatus> | null;
} => {
  // why: the transport answers positionally, so an address→status map is only
  // faithful if the request carried each address once — a repeated address would
  // spend a second ping and make one of the two answers unreachable.
  const uniqueAddresses = [...new Set(addresses)];
  const addressesKey = uniqueAddresses.join(',');
  const query = useQuery({
    queryKey: QUERY_KEYS.servers.statuses(addressesKey),
    queryFn: () => getServerStatuses(uniqueAddresses),
    staleTime: STATUS_STALE_TIME_MS,
    enabled: uniqueAddresses.length > 0,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `uniqueAddresses` is a fresh array on every render; addressesKey is its stable identity
  const byAddress = useMemo(() => {
    const data = query.data;
    if (!data) return null;
    const pairs: Array<readonly [string, ServerStatus]> = [];
    uniqueAddresses.forEach((address, index) => {
      const status = data[index];
      if (status) pairs.push([address, status]);
    });
    return new Map(pairs);
  }, [addressesKey, query.data]);

  return { isPending: query.isPending, isError: query.isError, byAddress };
};
