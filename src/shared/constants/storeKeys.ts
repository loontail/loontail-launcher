export const STORE_KEY_AUTH = 'auth';
export const STORE_KEY_LAUNCHER_SETTINGS = 'launcherSettings';
export const STORE_KEY_SCHEMA_VERSION = 'schemaVersion';

// Bump when LauncherSettings shape changes incompatibly and a migration is
// needed. `migrateStoredState` in main/infra/store inspects the persisted
// value and adapts older shapes forward.
export const CURRENT_SCHEMA_VERSION = 1;
