import { evictInactiveLocaleQueries } from '@renderer/shared/lib/localeQueryCache';
import { QUERY_KEYS } from '@shared/constants';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
  queryClient.setQueryData(QUERY_KEYS.catalog.list('en'), { items: ['en'] });
  queryClient.setQueryData(QUERY_KEYS.catalog.list('uk'), { items: ['uk'] });
  queryClient.setQueryData(QUERY_KEYS.settings.root, { locale: 'uk' });
});

afterEach(() => {
  queryClient.clear();
});

describe('evictInactiveLocaleQueries', () => {
  it('drops the previous locale catalog entry', () => {
    evictInactiveLocaleQueries(queryClient, 'uk');

    expect(queryClient.getQueryData(QUERY_KEYS.catalog.list('en'))).toBeUndefined();
  });

  it('keeps the active locale entry so a remounting grid still has its data', () => {
    evictInactiveLocaleQueries(queryClient, 'uk');

    expect(queryClient.getQueryData(QUERY_KEYS.catalog.list('uk'))).toEqual({ items: ['uk'] });
  });

  it('leaves non-catalog roots alone', () => {
    evictInactiveLocaleQueries(queryClient, 'uk');

    expect(queryClient.getQueryData(QUERY_KEYS.settings.root)).toEqual({ locale: 'uk' });
  });

  it('is a no-op when the active locale is the only cached one', () => {
    queryClient.removeQueries({ queryKey: QUERY_KEYS.catalog.list('en') });

    evictInactiveLocaleQueries(queryClient, 'uk');

    expect(queryClient.getQueryData(QUERY_KEYS.catalog.list('uk'))).toEqual({ items: ['uk'] });
  });
});
