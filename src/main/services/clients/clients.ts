import type { Client } from '@shared/contracts/client';
import type { ClientSlug } from '@shared/contracts/ids';
import type { StrapiList } from '@shared/contracts/strapi';
import { fetchClients } from './clientsApi';

const CACHE_TTL_MS = 30_000;
const DEFAULT_LOCALE_KEY = '__default__';

type CacheEntry = {
  at: number;
  locale: string | undefined;
  value: StrapiList<Client>;
};

let cache: CacheEntry | null = null;
const inFlight = new Map<string, Promise<StrapiList<Client>>>();

const localeKey = (locale: string | undefined): string => locale ?? DEFAULT_LOCALE_KEY;

const isFresh = (entry: CacheEntry, locale: string | undefined, now: number): boolean =>
  entry.locale === locale && now - entry.at < CACHE_TTL_MS;

// Renderer's TanStack Query owns the renderer-side cache; the IPC route stays
// uncached so locale switches and explicit refetches always hit Strapi.
export const getClients = (locale?: string): Promise<StrapiList<Client>> =>
  fetchClients(locale ? { locale } : {});

// Used inside main when install + launch + repair touch the client list
// back-to-back. The 30s TTL absorbs that burst; the in-flight map dedupes
// concurrent requests so a parallel install/launch doesn't hit Strapi twice.
export const getClientsCached = async (locale?: string): Promise<StrapiList<Client>> => {
  const now = Date.now();
  if (cache && isFresh(cache, locale, now)) return cache.value;
  const key = localeKey(locale);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = fetchClients(locale ? { locale } : {})
    .then((value) => {
      cache = { at: Date.now(), locale, value };
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
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
