import { scopedLogger } from '@main/infra/logger';
import { getClients } from '@main/services/clients';
import { listInstanceEntries } from '@main/services/instances/registry';
import { getSettings, writeSettings } from '@main/services/settings/settings';
import { localKey, officialKey } from '@shared/contracts/catalog';
import { asClientSlug } from '@shared/contracts/ids';
import { pruneClientOverrides } from '@shared/domain/settings';

const logger = scopedLogger('sweep-orphans');

// With a disk snapshot, cachedFetch returns the last known list so the sweep
// stays accurate on startup with no network; otherwise it skips silently.
export const sweepOrphanClientOverrides = async (): Promise<void> => {
  let list: Awaited<ReturnType<typeof getClients>>;
  try {
    list = await getClients();
  } catch (error) {
    logger.warn('skipping orphan sweep — clients fetch failed', error);
    return;
  }
  // An empty list means an unhealthy/empty backend (not "every official build
  // was deleted"); skip so a transient outage can't prune all official overrides.
  if (list.length === 0) return;
  // Overrides key by CatalogKey, so the keep-set must too: official builds as
  // `official:<slug>`, local builds as `local:<uuid>`. Without the local keys a
  // sweep would prune every local build's override (none match an official slug).
  const knownKeys = new Set<string>(
    list.map((client) => officialKey(asClientSlug(client.slug)) as string),
  );
  for (const entry of listInstanceEntries()) {
    knownKeys.add(localKey(entry.id) as string);
  }
  const current = getSettings();
  const pruned = pruneClientOverrides(current, knownKeys);
  if (pruned === current) return;
  const removed = Object.keys(current.clients).length - Object.keys(pruned.clients).length;
  writeSettings(pruned);
  logger.info(`pruned ${removed} orphan client override(s)`);
};
