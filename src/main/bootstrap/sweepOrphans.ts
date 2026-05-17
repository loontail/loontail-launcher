import { scopedLogger } from '@main/infra/logger';
import { getClientsCached } from '@main/services/clients';
import { getSettings, writeSettings } from '@main/services/settings/settings';
import { pruneClientOverrides } from '@shared/domain/settings';

const logger = scopedLogger('sweep-orphans');

// Best-effort: if Strapi is unreachable on startup, skip silently. The sweep
// rerun is harmless on the next successful launch.
export const sweepOrphanClientOverrides = async (): Promise<void> => {
  let list: Awaited<ReturnType<typeof getClientsCached>>;
  try {
    list = await getClientsCached();
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
