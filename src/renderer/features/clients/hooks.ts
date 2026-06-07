import { QUERY_KEYS } from '@shared/constants';
import { useQuery } from '@tanstack/react-query';
import { getServerStatuses } from './api';

const STATUS_STALE_TIME_MS = 30_000;

export const useServerStatuses = (addresses: string[]) => {
  const addressesKey = addresses.join(',');
  return useQuery({
    queryKey: QUERY_KEYS.servers.statuses(addressesKey),
    queryFn: () => getServerStatuses(addresses),
    staleTime: STATUS_STALE_TIME_MS,
    enabled: addresses.length > 0,
  });
};
