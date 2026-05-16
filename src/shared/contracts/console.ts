/**
 * Typed surfaces for the Minecraft game-console window. A
 * {@link ConsoleLine} is a single timestamped log entry — multi-line
 * stdout chunks are split on `\n` so the virtualized renderer can treat
 * each row as fixed-height.
 *
 * `id` is a monotonically increasing integer, scoped to the lifetime of
 * the launcher process. The renderer uses it to dedupe between the
 * initial snapshot pull and the live push stream.
 *
 * The console window is tied to a specific Minecraft session. It shows
 * only that session's stdout / stderr and synthetic system events
 * (launching, started, exited, crashed). Launcher-internal logs do not
 * appear here.
 */

import type { ClientSlug } from './ids';

/**
 * Origin of a console line.
 *
 * - `stdout` / `stderr` — Minecraft child-process streams.
 * - `system` — synthetic launcher messages tied to a session lifecycle
 *   (process started, crashed, etc.).
 */
export const ConsoleSources = {
  STDOUT: 'stdout',
  STDERR: 'stderr',
  SYSTEM: 'system',
} as const;

export type ConsoleSource = (typeof ConsoleSources)[keyof typeof ConsoleSources];

/** Severity of a console line. */
export const ConsoleLevels = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SYSTEM: 'system',
} as const;

export type ConsoleLevel = (typeof ConsoleLevels)[keyof typeof ConsoleLevels];

/** Interpolation args for a localized line `code`. */
export type ConsoleLineArgs = Record<string, string | number>;

export type ConsoleLine = {
  id: number;
  timestamp: number;
  level: ConsoleLevel;
  source: ConsoleSource;
  slug?: ClientSlug;
  message: string;
  code?: string;
  args?: ConsoleLineArgs;
};

/** Lifecycle status of the active Minecraft session, as seen by the console. */
export const ConsoleStatuses = {
  IDLE: 'idle',
  LAUNCHING: 'launching',
  RUNNING: 'running',
  EXITED: 'exited',
  ERROR: 'error',
  CRASHED: 'crashed',
} as const;

export type ConsoleProcessStatus = (typeof ConsoleStatuses)[keyof typeof ConsoleStatuses];

export type ConsoleProcessState = {
  slug: ClientSlug;
  status: ConsoleProcessStatus;
  clientTitle?: string;
  exitCode?: number | null;
  message?: string;
};

export type ConsoleInitialPayload = {
  activeSession: {
    slug: ClientSlug;
    clientTitle: string;
    state: ConsoleProcessState;
  } | null;
  lines: ConsoleLine[];
  droppedCount: number;
};
