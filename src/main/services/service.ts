// The contract src/main/index.ts drives its init/drain loops over. Declared once
// so a new service cannot quietly ship a different shape (e.g. a sync dispose)
// and only fail at the drain call site.
export type LauncherService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};
