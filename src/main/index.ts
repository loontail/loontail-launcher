import { seedLauncherSettings } from '@main/bootstrap/seed';
import { initLogger, scopedLogger } from '@main/infra/logger';
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
import { createMainWindow } from '@main/windows/mainWindow';
import { BrowserWindow, app, protocol } from 'electron';

initLogger();
const logger = scopedLogger('bootstrap');

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Must be called before app `ready`. The privileges let `<img src="cache://...">` resolve
// like a normal HTTPS resource (CSP, range requests, fetch API support).
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

  seedLauncherSettings();

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
