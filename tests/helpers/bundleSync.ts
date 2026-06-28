import {
  type ActiveSync,
  type SyncStateMap,
  createActiveSync,
  createSyncTask,
  markPaused,
} from '@main/services/bundle/syncState';
import {
  ClientOperationDomains,
  type ClientOperationLease,
} from '@main/services/clientOperationLocks';
import type { BundleSlug, CatalogKey } from '@shared/contracts/ids';

const noopLease = (slug: CatalogKey): ClientOperationLease => ({
  slug,
  domain: ClientOperationDomains.BUNDLE,
  resources: [],
  setCancel: () => {},
  release: () => {},
});

// Test helper: builds an ActiveSync through the real createSyncTask/createActiveSync
// so the seeded record shape lives in one place and tracks ActiveSync at compile
// time. A real ClientOperationLease can be supplied when the test asserts on lock
// release; otherwise a no-op lease is used.
export const seedActiveSync = (
  store: SyncStateMap,
  opts: {
    slug: CatalogKey;
    clientFolder: string;
    bundleSlug: BundleSlug;
    forLaunch: boolean;
    paused?: boolean;
    lock?: ClientOperationLease;
  },
): ActiveSync => {
  const task = createSyncTask(opts.slug, opts.clientFolder);
  if (opts.paused) markPaused(task);
  const active = createActiveSync(
    task,
    opts.lock ?? noopLease(opts.slug),
    opts.bundleSlug,
    opts.forLaunch,
  );
  store.set(opts.slug, active);
  return active;
};
