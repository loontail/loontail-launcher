import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import type { BundleInstallState } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';
import { describe, expect, it, vi } from 'vitest';

const RESULT: BundleInstallState = {
  installed: true,
  signatureMatches: true,
  progress: null,
};

type Deferred = {
  promise: Promise<BundleInstallState>;
  resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<BundleInstallState>((res) => {
    resolve = () => res(RESULT);
  });
  return { promise, resolve };
};

const pendingChecks = (): {
  getStatus: () => Promise<BundleInstallState>;
  created: Deferred[];
} => {
  const created: Deferred[] = [];
  return {
    created,
    getStatus: () => {
      const next = deferred();
      created.push(next);
      return next.promise;
    },
  };
};

const MAX_CONCURRENCY = 3;

describe('createStatusSeeder', () => {
  it('returns the same in-flight promise for a repeated key', () => {
    const getStatus = vi.fn(async () => RESULT);
    const seeder = createStatusSeeder(getStatus);
    const key = asCatalogKey('official:alpha');

    const first = seeder.seedStatus(key);
    const second = seeder.seedStatus(key);

    expect(second).toBe(first);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('caps the number of concurrent checks at the configured maximum', () => {
    const { getStatus } = pendingChecks();
    const spy = vi.fn(getStatus);
    const seeder = createStatusSeeder(spy, MAX_CONCURRENCY);

    for (let index = 0; index < 5; index += 1) {
      void seeder.seedStatus(asCatalogKey(`official:client-${index}`));
    }

    expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENCY);
  });

  it('drains the queue as in-flight checks settle', async () => {
    const { getStatus, created } = pendingChecks();
    const spy = vi.fn(getStatus);
    const seeder = createStatusSeeder(spy, MAX_CONCURRENCY);

    for (let index = 0; index < 4; index += 1) {
      void seeder.seedStatus(asCatalogKey(`official:client-${index}`));
    }
    expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENCY);

    created.at(0)?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('dedupes per seeder instance, so a fresh seeder re-checks the key', () => {
    const { getStatus } = pendingChecks();
    const spy = vi.fn(getStatus);
    const key = asCatalogKey('official:alpha');

    void createStatusSeeder(spy).seedStatus(key);
    void createStatusSeeder(spy).seedStatus(key);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
