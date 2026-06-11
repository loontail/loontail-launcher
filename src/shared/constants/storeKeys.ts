export const STORE_KEY_AUTH = 'auth';
export const STORE_KEY_LAUNCHER_SETTINGS = 'launcherSettings';
export const STORE_KEY_SCHEMA_VERSION = 'schemaVersion';
// Index of local user builds (fast catalog listing). Authoritative per-build
// data lives in each instance's `instance.json`; this index is rebuildable.
export const STORE_KEY_INSTANCE_REGISTRY = 'instanceRegistry';
// Map of CatalogKey -> last-played epoch ms. Powers the Home "Continue" hero
// and "Recently played" strip. Rebuildable from scratch (empty by default).
export const STORE_KEY_LAST_PLAYED = 'lastPlayedAt';

// Bump when LauncherSettings shape changes incompatibly and a migration is
// needed. `migrateStoredState` in main/infra/store inspects the persisted
// value and adapts older shapes forward.
export const CURRENT_SCHEMA_VERSION = 1;
