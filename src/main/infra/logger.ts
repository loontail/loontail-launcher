import log from 'electron-log/main';

export type Logger = ReturnType<typeof log.scope>;

let initialized = false;

export const initLogger = (): Logger => {
  if (!initialized) {
    log.initialize();
    log.transports.file.level = 'info';
    log.transports.console.level = 'debug';
    initialized = true;
  }
  return log.scope('main');
};

export const scopedLogger = (scope: string): Logger => log.scope(scope);
