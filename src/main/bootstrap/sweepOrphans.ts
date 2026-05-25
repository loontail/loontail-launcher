import { scopedLogger } from '@main/infra/logger';
import { getClients } from '@main/services/clients';
import { getSettings, writeSettings } from '@main/services/settings/settings';
import { pruneClientOverrides } from '@shared/domain/settings';

const logger = scopedLogger('sweep-orphans');

// Best-effort: if Strapi is unreachable AND no disk snapshot exists, skip
// silently. With a snapshot, cachedFetch returns the last known list so the
// sweep stays accurate even on startup with no network.
export const sweepOrphanClientOverrides = async (): Promise<void> => {
  let list: Awaited<ReturnType<typeof getClients>>;
  try {
    list = await getClients();
  } catch (error) {
    logger.warn('skipping orphan sweep — clients fetch failed', error);
    return;
  }
  const knownSlugs = new Set<string>(list.data.map((client) => client.slug));
  if (knownSlugs.size === 0) return;
  const current = getSettings();
  const pruned = pruneClientOverrides(current, knownSlugs);
  if (pruned === current) return;
  const removed = Object.keys(current.clients).length - Object.keys(pruned.clients).length;
  writeSettings(pruned);
  logger.info(`pruned ${removed} orphan client override(s)`);
};
