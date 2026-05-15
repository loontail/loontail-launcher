import { QUERY_KEYS } from '@shared/constants';
import type { Client } from '@shared/contracts/client';
import { useQuery } from '@tanstack/react-query';
import { getClients, getServerStatuses } from './api';

const CLIENTS_STALE_TIME_MS = 60_000;
const STATUS_STALE_TIME_MS = 30_000;

const sortClients = (clients: Client[]): Client[] =>
  [...clients].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

export const useClientsList = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.clients.list,
    queryFn: () => getClients(),
    staleTime: CLIENTS_STALE_TIME_MS,
  });
  const clients = sortClients(query.data?.data ?? []);
  return { clients, isPending: query.isPending, isError: query.isError };
};

export const useServerStatuses = (addresses: string[]) => {
  const addressesKey = addresses.join(',');
  return useQuery({
    queryKey: QUERY_KEYS.servers.statuses(addressesKey),
    queryFn: () => getServerStatuses(addresses),
    staleTime: STATUS_STALE_TIME_MS,
    enabled: addresses.length > 0,
  });
};
