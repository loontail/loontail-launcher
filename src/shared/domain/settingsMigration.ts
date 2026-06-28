import { localKey, officialKey } from '@shared/contracts/catalog';
import { asClientSlug, asInstanceId } from '@shared/contracts/ids';
import type { ClientSettingsOverride } from '@shared/contracts/settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG_KEY_RE = /^(official:|local:).+/;

// Lift a pre-CatalogKey client-override key onto the source-namespaced form.
// Before the migration the punned key was the bare operational id: an official
// slug for official builds, the instance UUID for local builds. A UUID-shaped
// key is a local build (`local:<uuid>`); anything else is an official build
// (`official:<slug>`). Already-namespaced keys pass through untouched.
export const migrateClientOverrideKey = (key: string): string => {
  if (CATALOG_KEY_RE.test(key)) return key;
  if (UUID_RE.test(key)) return localKey(asInstanceId(key)) as string;
  return officialKey(asClientSlug(key)) as string;
};

// Rehydrate every client-override key. A later key wins if two legacy keys map
// to the same CatalogKey (the namespaced form always overrides a bare form).
export const migrateClientOverrides = (
  clients: Record<string, ClientSettingsOverride>,
): Record<string, ClientSettingsOverride> => {
  const next: Record<string, ClientSettingsOverride> = {};
  let changed = false;
  for (const [key, override] of Object.entries(clients)) {
    const migrated = migrateClientOverrideKey(key);
    if (migrated !== key) changed = true;
    next[migrated] = override;
  }
  return changed ? next : clients;
};

// Rehydrate lastPlayed keys to the CatalogKey form. New writes already stamp by
// CatalogKey; this is the defensive read-time lift for any record persisted
// before that landed (bare slug/uuid keys).
export const migrateLastPlayedKeys = (
  lastPlayed: Record<string, number>,
): Record<string, number> => {
  const next: Record<string, number> = {};
  let changed = false;
  for (const [key, playedAt] of Object.entries(lastPlayed)) {
    const migrated = migrateClientOverrideKey(key);
    if (migrated !== key) changed = true;
    // Keep the most recent timestamp if two legacy keys collide.
    next[migrated] = Math.max(playedAt, next[migrated] ?? 0);
  }
  return changed ? next : lastPlayed;
};
