import { cachedFetch } from '@main/infra/cache';
import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import type { StrapiList } from '@shared/contracts/strapi';
import { fetchClients } from './clientsApi';

const CACHE_NAMESPACE = 'api/clients';

const cacheKeyFor = (locale: string | undefined): string => `list:${locale ?? '__default__'}`;

// Dedupes concurrent main-side callers (e.g. install + launch firing in
// parallel). No TTL — every resolved call fronts a fresh HTTP request and,
// on offline, the on-disk snapshot maintained by cachedFetch.
const inFlight = new Map<string, Promise<StrapiList<Client>>>();

export const getClients = (locale?: string): Promise<StrapiList<Client>> => {
  const key = cacheKeyFor(locale);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = cachedFetch({
    namespace: CACHE_NAMESPACE,
    key,
    fetcher: () => fetchClients(locale ? { locale } : {}),
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
};

export const getClient = async (slug: ClientSlug, locale?: string): Promise<Client> => {
  const list = await getClients(locale);
  const client = list.data.find((entry) => entry.slug === slug);
  if (!client) throw new Error(`Client "${slug}" not found`);
  return client;
};
