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
import { initLogger, scopedLogger } from '@main/infra/logger';
import { attachNotifier, notify } from '@main/infra/notifier';
import { configureSessionSecurity } from '@main/infra/session';
import { createRouter } from '@main/ipc/router';
import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { createAppService } from '@main/services/app';
import { createAuthService } from '@main/services/auth';
import { createClientsService } from '@main/services/clients';
import { createConsoleService } from '@main/services/console';
import { CACHE_SCHEME, createMediaService } from '@main/services/media';
import { createMinecraftService } from '@main/services/minecraft';
import { createServersService } from '@main/services/servers';
import { createSettingsService } from '@main/services/settings';
import { createSkinService } from '@main/services/skin';
import { createSystemService } from '@main/services/system';
import { createUpdaterService } from '@main/services/updater';
import { createMainWindow } from '@main/windows/mainWindow';
import { BrowserWindow, app, protocol } from 'electron';

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

app.on('second-instance', () => {
  const [existing] = BrowserWindow.getAllWindows();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  }
});

const start = async (): Promise<void> => {
  await app.whenReady();

  configureSessionSecurity();

  const mainWindow = createMainWindow();
  attachNotifier(mainWindow);
  const router = createRouter(createTrustedSenderCheck(mainWindow));

  const appService = createAppService(router);
  const authService = createAuthService(router);
  const systemService = createSystemService(router, mainWindow);
  const settingsService = createSettingsService(router, mainWindow);
  const skinService = createSkinService(router);
  const clientsService = createClientsService(router);
  const serversService = createServersService(router);
  const mediaService = createMediaService();
  const minecraftService = createMinecraftService(router, mainWindow);
  const consoleService = createConsoleService(router);
  const updaterService = createUpdaterService(router, mainWindow);

  await appService.init();
  await authService.init();
  await systemService.init();
  await settingsService.init();
  await skinService.init();
  await clientsService.init();
  await serversService.init();
  await mediaService.init();
  await minecraftService.init();
  await consoleService.init();
  await updaterService.init();

  seedLauncherSettings();
  void sweepOrphanClientOverrides();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  let disposed = false;
  const drain = async (): Promise<void> => {
    // Reverse-init order so consumers tear down before the infrastructure they depend on.
    await Promise.allSettled([
      updaterService.dispose(),
      consoleService.dispose(),
      minecraftService.dispose(),
      mediaService.dispose(),
      serversService.dispose(),
      clientsService.dispose(),
      skinService.dispose(),
      settingsService.dispose(),
      systemService.dispose(),
      authService.dispose(),
      appService.dispose(),
    ]);
    router.dispose();
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
  app.quit();
});
