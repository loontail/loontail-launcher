// Handles Squirrel.Windows shortcut create/remove during install/update flows,
// returning true to signal an immediate exit. Must run before any other Electron
// initialization.
import squirrelStartup from 'electron-squirrel-startup';

if (squirrelStartup) process.exit(0);

import { seedLauncherSettings } from '@main/bootstrap/seed';
import { sweepOrphanClientOverrides } from '@main/bootstrap/sweepOrphans';
import { configWarnings, mainConfig } from '@main/config';
import { createConsoleHub } from '@main/infra/consoleHub';
import { initLogger, scopedLogger } from '@main/infra/logger';
import { attachNotifier, notify } from '@main/infra/notifier';
import { configureSessionSecurity } from '@main/infra/session';
import { closeDatabase, initStore } from '@main/infra/store';
import { createRouter } from '@main/ipc/router';
import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { registerAppRoutes } from '@main/services/app/routes';
import { createAuthService } from '@main/services/auth';
import { getStoredAccount } from '@main/services/auth/auth';
import { createYggdrasilClient } from '@main/services/auth/yggdrasilClient';
import { createBundleService } from '@main/services/bundle';
import { clearLocalManifest } from '@main/services/bundle/manifestRepo';
import { resolveBundleRepairFilter } from '@main/services/bundle/ownership';
import { createCatalogService } from '@main/services/catalog';
import { createClientOperationLocks } from '@main/services/clientOperationLocks';
import { getClient, getClients } from '@main/services/clients';
import { createConsoleService } from '@main/services/console';
import { registerHistoryRoutes } from '@main/services/history/routes';
import { createKit } from '@main/services/kit';
import { createLocalBuildsService } from '@main/services/localBuilds';
import { registerMediaProtocol } from '@main/services/media/protocol';
import { registerMediaRoutes } from '@main/services/media/routes';
import { createMinecraftService } from '@main/services/minecraft';
import { registerServersRoutes } from '@main/services/servers/routes';
import type { LauncherService } from '@main/services/service';
import { registerSettingsRoutes } from '@main/services/settings/routes';
import { createSkinService } from '@main/services/skin';
import { registerSystemRoutes } from '@main/services/system/routes';
import { createUpdaterService } from '@main/services/updater';
import { openConsoleWindow } from '@main/windows/consoleWindow';
import { createMainWindow, installMainWindowLifecycle } from '@main/windows/mainWindow';
import { CACHE_SCHEME } from '@shared/constants';
import { app, type BrowserWindow, dialog, protocol } from 'electron';

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
  for (const warning of configWarnings(mainConfig)) logger.warn(warning);

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
  // Stateless route registration: no lifecycle, no teardown, no ordering.
  registerAppRoutes(router);
  registerSystemRoutes(router, getMainWindow);
  registerSettingsRoutes(router, getMainWindow);
  registerServersRoutes(router);
  registerHistoryRoutes(router);
  // The cache:// handler lives for the process lifetime (Electron unregisters it
  // on exit), so there is nothing to tear down.
  registerMediaProtocol();
  registerMediaRoutes(router);

  const authService = createAuthService(router, kit, yggdrasilGateway);
  const skinService = createSkinService(router, kit, yggdrasilGateway, authService.session);
  const localBuildsService = createLocalBuildsService(router, kit);
  const catalogService = createCatalogService(router, {
    listClients: getClients,
    extraSources: [localBuildsService.localSource],
  });
  const minecraftService = createMinecraftService(
    router,
    getMainWindow,
    kit,
    clientOperationLocks,
    consoleHub,
    openConsole,
    getStoredAccount,
    resolveBundleRepairFilter,
    clearLocalManifest,
    (key) => catalogService.catalog.resolveBuildByKey(key),
  );
  const bundleService = createBundleService(
    router,
    getMainWindow,
    kit,
    clientOperationLocks,
    { resolveContext: (key) => minecraftService.manager.resolveInstallContext(key) },
    getClient,
  );
  // Bundle sync runs after install, before launch; a no-op without a bundleSlug.
  minecraftService.manager.attachLaunchHook((key, signal) =>
    bundleService.manager.syncForLaunch(key, signal),
  );
  const consoleService = createConsoleService(router, consoleHub, openConsole);
  const updaterService = createUpdaterService(router, getMainWindow);

  // Only modules that own state or teardown are lifecycle-managed. Init order
  // matters (localBuilds -> catalog, auth's session port before any HTTP call);
  // dispose order does not, because teardown is independent.
  const services: readonly LauncherService[] = [
    authService,
    skinService,
    localBuildsService,
    catalogService,
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
    // The DB is closed after the bundle drain (a 250ms bounded wait in
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
