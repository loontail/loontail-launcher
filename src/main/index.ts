// Handles Squirrel.Windows shortcut create/remove during install/update flows,
// returning true to signal an immediate exit. Must run before any other Electron
// initialization.
import squirrelStartup from 'electron-squirrel-startup';
if (squirrelStartup) process.exit(0);

import { seedLauncherSettings } from '@main/bootstrap/seed';
import { sweepOrphanClientOverrides } from '@main/bootstrap/sweepOrphans';
import { createConsoleHub } from '@main/infra/consoleHub';
import { initLogger, scopedLogger } from '@main/infra/logger';
import { attachNotifier, notify } from '@main/infra/notifier';
import { configureSessionSecurity } from '@main/infra/session';
import { closeDatabase, initStore } from '@main/infra/store';
import { createRouter } from '@main/ipc/router';
import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { createAppService } from '@main/services/app';
import { createAuthService } from '@main/services/auth';
import { getStoredAccount } from '@main/services/auth/auth';
import { createYggdrasilClient } from '@main/services/auth/yggdrasilClient';
import { createBundleService } from '@main/services/bundle';
import { resolveBundleRepairFilter } from '@main/services/bundle/ownership';
import { createCatalogService } from '@main/services/catalog';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { getClient, getClients } from '@main/services/clients';
import { createConsoleService } from '@main/services/console';
import { createHistoryService } from '@main/services/history';
import { createInstancesService } from '@main/services/instances';
import { createKit } from '@main/services/kit';
import { CACHE_SCHEME, createMediaService } from '@main/services/media';
import { createMinecraftService } from '@main/services/minecraft';
import { createServersService } from '@main/services/servers';
import { createSettingsService } from '@main/services/settings';
import { createSkinService } from '@main/services/skin';
import { createSystemService } from '@main/services/system';
import { createUpdaterService } from '@main/services/updater';
import { openConsoleWindow } from '@main/windows/consoleWindow';
import { createMainWindow, installMainWindowLifecycle } from '@main/windows/mainWindow';
import { type BrowserWindow, app, dialog, protocol } from 'electron';

initLogger();
const logger = scopedLogger('bootstrap');

const summarize = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  notify.error(`Uncaught exception: ${summarize(error)}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
  notify.error(`Unhandled rejection: ${summarize(reason)}`);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Must be registered before app ready so `cache://` resolves like an https
// resource (CSP, range requests, fetch API).
protocol.registerSchemesAsPrivileged([
  {
    scheme: CACHE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

const start = async (): Promise<void> => {
  await app.whenReady();

  // Run migrations and purge legacy auth before any service reads the store.
  initStore();

  configureSessionSecurity();

  // One console hub for the process, threaded into every consumer instead of a
  // module singleton so its buffer/timer state is owned by the bootstrap.
  const consoleHub = createConsoleHub();
  // Read through getMainWindow so window-dependent consumers follow a macOS dock
  // re-open (a recreated window) without rewiring.
  const mainWindowHolder = installMainWindowLifecycle({
    app,
    consoleHub,
    createWindow: createMainWindow,
    attachNotifier,
  });
  const getMainWindow = (): BrowserWindow => mainWindowHolder.get();
  const openConsole = (): void => {
    openConsoleWindow(consoleHub);
  };
  const router = createRouter(createTrustedSenderCheck(getMainWindow, consoleHub));

  const kit = createKit();
  const yggdrasilGateway = createYggdrasilClient();
  const clientOperationLocks = createClientOperationLocks();
  const appService = createAppService(router);
  const authService = createAuthService(router, kit, yggdrasilGateway);
  const systemService = createSystemService(router, getMainWindow);
  const settingsService = createSettingsService(router, getMainWindow);
  const skinService = createSkinService(router, kit, yggdrasilGateway, authService.session);
  const instancesService = createInstancesService(router, kit);
  const catalogService = createCatalogService(router, {
    listClients: getClients,
    extraSources: [instancesService.localSource],
  });
  const serversService = createServersService(router);
  const historyService = createHistoryService(router);
  const mediaService = createMediaService(router);
  const minecraftService = createMinecraftService(
    router,
    getMainWindow,
    kit,
    clientOperationLocks,
    consoleHub,
    openConsole,
    getStoredAccount,
    resolveBundleRepairFilter,
    (key) => catalogService.catalog.resolveBuildByKey(key),
  );
  const bundleService = createBundleService(
    router,
    getMainWindow,
    kit,
    clientOperationLocks,
    { resolveContext: (slug) => minecraftService.manager.resolveHealTarget(slug) },
    getClient,
  );
  // Bundle sync runs after install, before launch; a no-op without a bundleSlug.
  minecraftService.manager.attachLaunchHook((slug, signal) =>
    bundleService.manager.syncForLaunch(slug, signal),
  );
  const consoleService = createConsoleService(router, consoleHub, openConsole);
  const updaterService = createUpdaterService(router, getMainWindow);

  // Init order matters (instances -> catalog, etc.); dispose order does not,
  // because teardown is independent.
  const services = [
    appService,
    authService,
    systemService,
    settingsService,
    skinService,
    instancesService,
    catalogService,
    serversService,
    historyService,
    mediaService,
    minecraftService,
    bundleService,
    consoleService,
    updaterService,
  ];

  for (const service of services) {
    await service.init();
  }

  await seedLauncherSettings();
  void sweepOrphanClientOverrides();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  let disposed = false;
  const drain = async (): Promise<void> => {
    clientOperationLocks.cancelAll();
    // Dispose concurrently — teardown is independent, so a slow one can't block
    // the rest; the database is closed last, after this settles.
    //
    // BUG-7: the DB is closed after the bundle drain (a 250ms bounded wait in
    // BundleManager.cancelAll), so no sync teardown (`finally`) may issue a
    // store/DB write — it could be truncated or race this close. See
    // BundleManager.cancelAll for the full invariant.
    await Promise.allSettled(services.map((service) => service.dispose()));
    router.dispose();
    closeDatabase();
    logger.info('Launcher disposed');
  };

  app.on('before-quit', (event) => {
    if (disposed) return;
    event.preventDefault();
    disposed = true;
    void drain().finally(() => app.quit());
  });

  logger.info('Launcher started');
};

start().catch((error: unknown) => {
  logger.error('Failed to start launcher', error);
  dialog.showErrorBox('Launcher failed to start', summarize(error));
  app.quit();
});
