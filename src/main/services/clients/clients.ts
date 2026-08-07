import { cachedFetch } from '@main/infra/cache';
import type { Client } from '@shared/contracts/client';
import { ClientSchema } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import { fetchClients } from './clientsApi';

const CACHE_NAMESPACE = 'api/clients';

const cacheKeyFor = (locale: string | undefined): string => `list:${locale ?? '__default__'}`;

// Dedupes concurrent callers (e.g. install + launch in parallel). No TTL: each
// resolved call re-fetches, falling back to cachedFetch's on-disk snapshot offline.
const inFlight = new Map<string, Promise<Client[]>>();

const parseClientsSnapshot = (value: unknown): Client[] | null => {
  const parsed = ClientSchema.array().safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const getClients = (locale?: string): Promise<Client[]> => {
  const key = cacheKeyFor(locale);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = cachedFetch({
    namespace: CACHE_NAMESPACE,
    key,
    fetcher: () => fetchClients(locale ? { locale } : {}),
    parseSnapshot: parseClientsSnapshot,
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
};

export const getClient = async (slug: ClientSlug, locale?: string): Promise<Client> => {
  const list = await getClients(locale);
  const client = list.find((entry) => entry.slug === slug);
  if (!client) throw new Error(`Client "${slug}" not found`);
  return client;
};
