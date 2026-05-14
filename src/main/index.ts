import { seedLauncherSettings } from '@main/bootstrap/seed';
import { initLogger, scopedLogger } from '@main/infra/logger';
import { configureSessionSecurity } from '@main/infra/session';
import { createRouter } from '@main/ipc/router';
import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { createAppService } from '@main/services/app';
import { createAuthService } from '@main/services/auth';
import { createSettingsService } from '@main/services/settings';
import { createSkinService } from '@main/services/skin';
import { createSystemService } from '@main/services/system';
import { createMainWindow } from '@main/windows/mainWindow';
import { BrowserWindow, app } from 'electron';

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

  await appService.init();
  await authService.init();
  await systemService.init();
  await settingsService.init();
  await skinService.init();

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

  app.on('before-quit', () => {
    void skinService.dispose();
    void settingsService.dispose();
    void systemService.dispose();
    void authService.dispose();
    void appService.dispose();
    router.dispose();
  });

  logger.info('Launcher started');
};

start().catch((error: unknown) => {
  logger.error('Failed to start launcher', error);
  app.quit();
});
