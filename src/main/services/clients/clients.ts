import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import type { StrapiList } from '@shared/contracts/strapi';
import { fetchClients } from './clientsApi';

const CACHE_TTL_MS = 30_000;

type CacheEntry = {
  at: number;
  locale: string | undefined;
  value: StrapiList<Client>;
};

let cache: CacheEntry | null = null;

const isFresh = (entry: CacheEntry, locale: string | undefined, now: number): boolean =>
  entry.locale === locale && now - entry.at < CACHE_TTL_MS;

// IPC route consumer — always hits Strapi. The renderer's TanStack Query
// owns the renderer-side cache; refreshing here would defeat that.
export const getClients = (locale?: string): Promise<StrapiList<Client>> =>
  fetchClients(locale ? { locale } : {});

// Used inside main when several services need the latest client list for the
// same user action (install + launch + repair touch it back-to-back). The
// in-memory entry lasts CACHE_TTL_MS to absorb that burst without firing a
// round-trip per call.
export const getClientsCached = async (locale?: string): Promise<StrapiList<Client>> => {
  const now = Date.now();
  if (cache && isFresh(cache, locale, now)) return cache.value;
  const value = await fetchClients(locale ? { locale } : {});
  cache = { at: now, locale, value };
  return value;
};

export const getClient = async (slug: ClientSlug, locale?: string): Promise<Client> => {
  const list = await getClientsCached(locale);
  const client = list.data.find((entry) => entry.slug === slug);
  if (!client) throw new Error(`Client "${slug}" not found`);
  return client;
};

export const invalidateClientsCache = (): void => {
  cache = null;
};
