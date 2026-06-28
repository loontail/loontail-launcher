import { describe, expect, it, vi } from 'vitest';

// queryPersister.ts instantiates a localStorage-backed persister at module scope,
// so stub window.localStorage before importing the module to read the pure predicate.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      },
    },
  });
});

import { shouldDehydrateQuery } from '@renderer/shared/lib/queryPersister';
import { QUERY_KEY_ROOTS } from '@shared/constants';
import type { Query } from '@tanstack/react-query';

const queryFor = (root: string, status: 'success' | 'pending' | 'error' = 'success'): Query =>
  ({ queryKey: [root, 'detail'], state: { status } }) as unknown as Query;

const PERSISTED = [
  QUERY_KEY_ROOTS.catalog,
  QUERY_KEY_ROOTS.settings,
  QUERY_KEY_ROOTS.auth,
  QUERY_KEY_ROOTS.history,
];

const NOT_PERSISTED = [
  QUERY_KEY_ROOTS.system,
  QUERY_KEY_ROOTS.builds,
  QUERY_KEY_ROOTS.media,
  QUERY_KEY_ROOTS.app,
  QUERY_KEY_ROOTS.servers,
];

describe('shouldDehydrateQuery', () => {
  it.each(PERSISTED)('persists successful %s queries', (root) => {
    expect(shouldDehydrateQuery(queryFor(root))).toBe(true);
  });

  it.each(NOT_PERSISTED)('does not persist successful %s queries', (root) => {
    expect(shouldDehydrateQuery(queryFor(root))).toBe(false);
  });

  it.each(['pending', 'error'] as const)(
    'does not persist allow-listed roots in %s state',
    (status) => {
      for (const root of PERSISTED) {
        expect(shouldDehydrateQuery(queryFor(root, status))).toBe(false);
      }
    },
  );

  it('does not persist queries with a non-string root', () => {
    const query = { queryKey: [42], state: { status: 'success' } } as unknown as Query;
    expect(shouldDehydrateQuery(query)).toBe(false);
  });
});
