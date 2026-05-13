import { initLogger, scopedLogger } from '@main/infra/logger';
import { configureSessionSecurity } from '@main/infra/session';
import { createRouter } from '@main/ipc/router';
import { createTrustedSenderCheck } from '@main/ipc/trustedSender';
import { createAppService } from '@main/services/app';
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

const start = async (): Promise<void> => {
  await app.whenReady();

  configureSessionSecurity();

  const mainWindow = createMainWindow();
  const router = createRouter(createTrustedSenderCheck(mainWindow));

  const appService = createAppService(router);
  await appService.init();

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
    void appService.dispose();
    router.dispose();
  });

  logger.info('Launcher started');
};

start().catch((error: unknown) => {
  logger.error('Failed to start launcher', error);
  app.quit();
});
