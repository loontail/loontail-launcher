import { markPaused } from '@main/infra/lifecyclePhase';
import {
  type ActiveSync,
  createActiveSync,
  createSyncTask,
  type SyncStateMap,
} from '@main/services/bundle/syncState';
import {
  ClientOperationDomains,
  type ClientOperationLease,
} from '@main/services/clientOperationLocks';
import type { BundleSlug, CatalogKey } from '@shared/contracts/ids';

const noopLease = (key: CatalogKey): ClientOperationLease => ({
  key,
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
    key: CatalogKey;
    clientFolder: string;
    bundleSlug: BundleSlug;
    forLaunch: boolean;
    paused?: boolean;
    lock?: ClientOperationLease;
  },
): ActiveSync => {
  const task = createSyncTask(opts.key, opts.clientFolder);
  if (opts.paused) markPaused(task);
  const active = createActiveSync(
    task,
    opts.lock ?? noopLease(opts.key),
    opts.bundleSlug,
    opts.forLaunch,
  );
  store.set(opts.key, active);
  return active;
};
