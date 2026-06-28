import type { CatalogKey } from './ids';

export type ConsoleSource = 'stdout' | 'stderr' | 'system';

export const ConsoleSources = {
  STDOUT: 'stdout',
  STDERR: 'stderr',
  SYSTEM: 'system',
} as const satisfies Record<string, ConsoleSource>;

export type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error' | 'system';

export const ConsoleLevels = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SYSTEM: 'system',
} as const satisfies Record<string, ConsoleLevel>;

export type ConsoleLineArgs = Record<string, string | number>;

export type ConsoleLine = {
  id: number;
  timestamp: number;
  level: ConsoleLevel;
  source: ConsoleSource;
  slug?: CatalogKey;
  message: string;
  code?: string;
  args?: ConsoleLineArgs;
};

export type ConsoleProcessStatus =
  | 'idle'
  | 'launching'
  | 'running'
  | 'exited'
  | 'error'
  | 'crashed';

export const ConsoleStatuses = {
  IDLE: 'idle',
  LAUNCHING: 'launching',
  RUNNING: 'running',
  EXITED: 'exited',
  ERROR: 'error',
  CRASHED: 'crashed',
} as const satisfies Record<string, ConsoleProcessStatus>;

export type ConsoleProcessState = {
  slug: CatalogKey;
  status: ConsoleProcessStatus;
  clientTitle?: string;
  exitCode?: number | null;
  message?: string;
};

export type ConsoleInitialPayload = {
  activeSession: {
    slug: CatalogKey;
    clientTitle: string;
    state: ConsoleProcessState;
  } | null;
  lines: ConsoleLine[];
  droppedCount: number;
};
