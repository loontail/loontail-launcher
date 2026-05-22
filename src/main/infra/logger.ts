import log from 'electron-log/main';

export type Logger = ReturnType<typeof log.scope>;

let initialized = false;

export const initLogger = (): Logger => {
  if (!initialized) {
    log.initialize();
    log.transports.file.level = 'info';
    log.transports.console.level = 'debug';
    // Route raw console.* calls through electron-log so the launcher's log
    // file captures output from dependencies that write directly via
    // `console.warn` / `console.error` (e.g. minecraft-kit's `authDebug`).
    // Without this, those lines only go to the OS-level stdout and disappear
    // when the launcher isn't started from a terminal.
    Object.assign(console, log.functions);
    initialized = true;
  }
  return log.scope('main');
};

export const scopedLogger = (scope: string): Logger => log.scope(scope);
