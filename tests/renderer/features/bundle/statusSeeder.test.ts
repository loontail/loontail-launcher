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
  checkStatus: () => Promise<BundleInstallState>;
  created: Deferred[];
} => {
  const created: Deferred[] = [];
  return {
    created,
    checkStatus: () => {
      const next = deferred();
      created.push(next);
      return next.promise;
    },
  };
};

const MAX_CONCURRENCY = 3;

describe('createStatusSeeder', () => {
  it('returns the same in-flight promise for a repeated slug', () => {
    const checkStatus = vi.fn(async () => RESULT);
    const seeder = createStatusSeeder(checkStatus);
    const slug = asCatalogKey('official:alpha');

    const first = seeder.seedStatus(slug);
    const second = seeder.seedStatus(slug);

    expect(second).toBe(first);
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  it('caps the number of concurrent checks at the configured maximum', () => {
    const { checkStatus } = pendingChecks();
    const spy = vi.fn(checkStatus);
    const seeder = createStatusSeeder(spy, MAX_CONCURRENCY);

    for (let index = 0; index < 5; index += 1) {
      void seeder.seedStatus(asCatalogKey(`official:client-${index}`));
    }

    expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENCY);
  });

  it('drains the queue as in-flight checks settle', async () => {
    const { checkStatus, created } = pendingChecks();
    const spy = vi.fn(checkStatus);
    const seeder = createStatusSeeder(spy, MAX_CONCURRENCY);

    for (let index = 0; index < 4; index += 1) {
      void seeder.seedStatus(asCatalogKey(`official:client-${index}`));
    }
    expect(spy).toHaveBeenCalledTimes(MAX_CONCURRENCY);

    created.at(0)?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('reset clears the in-flight cache so a new call re-checks the slug', () => {
    const { checkStatus } = pendingChecks();
    const spy = vi.fn(checkStatus);
    const seeder = createStatusSeeder(spy);
    const slug = asCatalogKey('official:alpha');

    void seeder.seedStatus(slug);
    seeder.reset();
    void seeder.seedStatus(slug);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
