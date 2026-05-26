import { YggdrasilClient } from '@loontail/yggdrasil-client';
import { mainConfig } from '@main/config';

let cached: YggdrasilClient | null = null;

/**
 * Shared singleton instance of {@link YggdrasilClient}. Constructed
 * lazily on first call so process-level config (`mainConfig`) is
 * available when imports settle. Reuse this everywhere so the
 * authentication, skin upload, and profile-enrichment paths share
 * the same fetch-side fixtures.
 */
export const getYggdrasilClient = (): YggdrasilClient => {
  if (!cached) {
    cached = new YggdrasilClient({ apiRoot: mainConfig.yggdrasilApiRoot });
  }
  return cached;
};
