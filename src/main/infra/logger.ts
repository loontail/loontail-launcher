import type { Logger as KitLogger, LogLevel } from '@loontail/minecraft-kit';
import log from 'electron-log/main';

export type Logger = ReturnType<typeof log.scope>;

let initialized = false;

export const initLogger = (): Logger => {
  if (!initialized) {
    log.initialize();
    log.transports.file.level = 'info';
    log.transports.console.level = 'debug';
    // Cap on-disk log volume. electron-log's default archiveLogFn does a single
    // `main.log` → `main.old.log` swap, so total usage is bounded to ~2× this.
    log.transports.file.maxSize = 5 * 1024 * 1024;
    // Route raw console.* calls through electron-log so the launcher's log
    // file captures output from dependencies that write directly via
    // `console.warn` / `console.error`. Without this, those lines only go to
    // the OS-level stdout and disappear when the launcher isn't started from
    // a terminal.
    Object.assign(console, log.functions);
    initialized = true;
  }
  return log.scope('main');
};

export const scopedLogger = (scope: string): Logger => log.scope(scope);

/**
 * Adapt an electron-log scope to the kit's pluggable `Logger` interface so
 * `new MinecraftKit({ logger })` writes through the same sinks as the rest
 * of the launcher (file + console).
 */
export const kitLogger = (scope: string): KitLogger => {
  const scoped = log.scope(scope);
  return {
    log: (level: LogLevel, message: string, fields?: Readonly<Record<string, unknown>>): void => {
      if (fields === undefined) scoped[level](message);
      else scoped[level](message, fields);
    },
  };
};
