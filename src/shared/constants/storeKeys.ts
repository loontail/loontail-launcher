export const STORE_KEY_AUTH = 'auth';
export const STORE_KEY_LAUNCHER_SETTINGS = 'launcherSettings';
export const STORE_KEY_SCHEMA_VERSION = 'schemaVersion';
// Index for fast catalog listing; each `instance.json` is authoritative, so this
// is rebuildable.
export const STORE_KEY_INSTANCE_REGISTRY = 'instanceRegistry';
// Map of CatalogKey -> last-played epoch ms; rebuildable, empty by default.
export const STORE_KEY_LAST_PLAYED = 'lastPlayedAt';

// Bump when LauncherSettings changes incompatibly; `migrateStoredState` adapts
// older persisted shapes forward.
export const CURRENT_SCHEMA_VERSION = 1;
