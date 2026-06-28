// Squirrel.Windows spawns the packaged exe with `--squirrel-install`,
// `--squirrel-uninstall`, `--squirrel-updated`, `--squirrel-obsolete`, or
// `--squirrel-firstrun` during install/update/uninstall flows. The
// `electron-squirrel-startup` module handles shortcut create/remove for those
// arg variants and returns `true` so the app should exit immediately. This
// has to run before any other Electron initialization.
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

// Must be registered before app ready so `<img src="cache://...">` resolves
// like an https resource (CSP, range requests, fetch API).
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

  // Run schema migrations and purge legacy auth before any service reads the
  // store; importing the store module no longer triggers this as a side effect.
  initStore();

  configureSessionSecurity();

  // One console hub for the process, created here and threaded into every
  // consumer (launch flow, console service, trusted-sender check) instead of a
  // module singleton, so its buffer/timer state is owned by the bootstrap.
  const consoleHub = createConsoleHub();
  // The main window is owned by the lifecycle holder: closing it also closes
  // the console, `second-instance`/`activate` target the main ref, and the
  // notifier follows a macOS dock re-open. Read through getMainWindow so every
  // window-dependent consumer follows the live window without rewiring.
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
  // Wire bundle sync into the launch flow — runs after install, before launch.
  // No-op for clients without a bundleSlug (handled inside syncForLaunch).
  minecraftService.manager.attachLaunchHook((slug, signal) =>
    bundleService.manager.syncForLaunch(slug, signal),
  );
  const consoleService = createConsoleService(router, consoleHub, openConsole);
  const updaterService = createUpdaterService(router, getMainWindow);

  // One ordered registry drives both startup (sequential, in this order) and
  // teardown (concurrent). The init order matters (instances -> catalog, etc.);
  // dispose order does not because teardown is independent.
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
    // Dispose every service concurrently — teardown is independent (each only
    // releases its own listeners/timers/children), so order doesn't matter and
    // a slow one can't block the rest. cancelAll above already stopped in-flight
    // work; the database is closed last, after this settles.
    //
    // BUG-7: the database is closed here, after the bundle drain (a 250ms
    // bounded wait in BundleManager.cancelAll). No sync teardown (`finally`) may
    // issue a store/DB write — it could be truncated by that timeout or race
    // this close. See BundleManager.cancelAll for the full invariant.
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
