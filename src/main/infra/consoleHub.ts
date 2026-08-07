import { CONSOLE_BUFFER_LIMIT } from '@shared/constants';
import {
  type ConsoleInitialPayload,
  type ConsoleLevel,
  ConsoleLevels,
  type ConsoleLineArgs,
  type ConsoleProcessState,
  type ConsoleSource,
  ConsoleSources,
} from '@shared/contracts/console';
import type { CatalogKey } from '@shared/contracts/ids';
import { emit, IPC_EVENTS, type IpcEventPayloads } from '@shared/ipc';
import type { BrowserWindow } from 'electron';
import { ConsoleBuffer, type ConsoleLineInput } from './consoleBuffer';
import { formatLog4jLine, type Log4jEvent, Log4jStreamParser, mapLog4jLevel } from './log4jStream';

type ConsoleEventChannel = (typeof IPC_EVENTS)[
  | 'consoleLines'
  | 'consoleState'
  | 'consoleBufferReset'];

const FLUSH_INTERVAL_MS = 50;

const ANSI_ESCAPE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences contain ESC (0x1b)
  /\x1b\[[0-9;]*m/g;

const ERROR_LEVEL_PATTERN = /\b(ERROR|SEVERE|FATAL)\b/;
const WARN_LEVEL_PATTERN = /\bWARN(ING)?\b/;
const DEBUG_LEVEL_PATTERN = /\b(DEBUG|TRACE|FINE|FINER|FINEST)\b/;

const stripAnsi = (raw: string): string => raw.replace(ANSI_ESCAPE_PATTERN, '');

const guessLevel = (source: ConsoleSource, message: string): ConsoleLevel => {
  if (source === ConsoleSources.STDERR) return ConsoleLevels.ERROR;
  if (source === ConsoleSources.SYSTEM) return ConsoleLevels.SYSTEM;
  if (ERROR_LEVEL_PATTERN.test(message)) return ConsoleLevels.ERROR;
  if (WARN_LEVEL_PATTERN.test(message)) return ConsoleLevels.WARN;
  if (DEBUG_LEVEL_PATTERN.test(message)) return ConsoleLevels.DEBUG;
  return ConsoleLevels.INFO;
};

const LEVEL_FROM_LOG4J: Record<ReturnType<typeof mapLog4jLevel>, ConsoleLevel> = {
  debug: ConsoleLevels.DEBUG,
  info: ConsoleLevels.INFO,
  warn: ConsoleLevels.WARN,
  error: ConsoleLevels.ERROR,
};

export const buildLineInput = (args: {
  level: ConsoleLevel;
  source: ConsoleSource;
  message: string;
  key?: CatalogKey | undefined;
  code?: string | undefined;
  args?: ConsoleLineArgs | undefined;
}): ConsoleLineInput => {
  const line: ConsoleLineInput = {
    level: args.level,
    source: args.source,
    message: args.message,
  };
  if (args.key) line.key = args.key;
  if (args.code) {
    line.code = args.code;
    if (args.args) line.args = args.args;
  }
  return line;
};

export type SessionInfo = {
  key: CatalogKey;
  clientTitle: string;
  state: ConsoleProcessState;
};

export class ConsoleHub {
  private readonly buffer = new ConsoleBuffer({ limit: CONSOLE_BUFFER_LIMIT });
  private window: BrowserWindow | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private activeSession: SessionInfo | null = null;
  private readonly log4j = new Log4jStreamParser();

  attach(window: BrowserWindow): void {
    this.window = window;
    window.on('closed', () => {
      // Guard against a stale handler from a previously attached window: a reopen
      // races the old window's `closed`, which would otherwise drop the new one.
      if (this.window !== window) return;
      this.window = null;
      this.clearFlushTimer();
      this.buffer.clearPending();
    });
  }

  hasWindow(): boolean {
    return this.window != null && !this.window.isDestroyed();
  }

  getWindow(): BrowserWindow | null {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window;
  }

  getInitial(): ConsoleInitialPayload {
    return {
      activeSession: this.activeSession ? { ...this.activeSession } : null,
      lines: this.buffer.getLines(),
      droppedCount: this.buffer.getDroppedCount(),
    };
  }

  clear(): void {
    this.clearFlushTimer();
    this.buffer.clear();
    this.sendToWindow(IPC_EVENTS.consoleBufferReset, null);
  }

  copyAll(): string {
    return this.buffer.copyAll();
  }

  recordMinecraft(
    key: CatalogKey,
    stream: typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR,
    text: string,
  ): void {
    for (const chunk of this.log4j.feed(stream, text)) {
      if (chunk.kind === 'text') {
        this.ingest({ source: stream, raw: chunk.text, key });
      } else {
        this.ingestLog4jEvent(stream, key, chunk.event);
      }
    }
  }

  private ingestLog4jEvent(
    source: typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR,
    key: CatalogKey,
    event: Log4jEvent,
  ): void {
    const level = LEVEL_FROM_LOG4J[mapLog4jLevel(event.level)];
    const lines = event.message.split(/\r?\n/);
    const throwableLines = event.throwable ? event.throwable.split(/\r?\n/) : [];
    const all = [...lines, ...throwableLines].filter((line) => line.length > 0);
    if (all.length === 0) return;
    for (const line of all) {
      this.ingest({
        source,
        raw: formatLog4jLine(event, line),
        forcedLevel: level,
        key,
      });
    }
  }

  recordSystem(
    message: string,
    options?: { code?: string; args?: ConsoleLineArgs; key?: CatalogKey },
  ): void {
    this.ingest({
      source: ConsoleSources.SYSTEM,
      raw: message,
      forcedLevel: ConsoleLevels.SYSTEM,
      key: options?.key,
      code: options?.code,
      args: options?.args,
    });
  }

  setActiveSession(session: SessionInfo | null): void {
    // Drain partial XML from the previous session before reset, else a trailing
    // fragment leaks into the new session.
    if (this.activeSession) this.drainLog4j(this.activeSession.key);
    this.clearFlushTimer();
    this.log4j.reset();
    this.activeSession = session;
  }

  // Flush the parsers on process exit: a FATAL crash event is often split across
  // the final lines and would otherwise be held in the parser buffer until the
  // next reset (i.e. discarded). Called before emitting EXITED/CRASHED.
  endSession(key: CatalogKey): void {
    this.drainLog4j(key);
    this.log4j.reset();
  }

  private drainLog4j(key: CatalogKey): void {
    for (const stream of [ConsoleSources.STDOUT, ConsoleSources.STDERR] as const) {
      for (const chunk of this.log4j.flush(stream)) {
        if (chunk.kind === 'text' && chunk.text.length > 0) {
          this.ingest({ source: stream, raw: chunk.text, key });
        } else if (chunk.kind === 'event') {
          this.ingestLog4jEvent(stream, key, chunk.event);
        }
      }
    }
  }

  emitState(state: ConsoleProcessState): void {
    // Tag with the active session's title only when the state belongs to it; a
    // terminal state for a different key (an older client exiting after a newer
    // launch became active) must keep its own title.
    const matchesActive = this.activeSession?.key === state.key;
    if (this.activeSession && matchesActive) {
      this.activeSession = {
        ...this.activeSession,
        state: { ...state, clientTitle: this.activeSession.clientTitle },
      };
    }
    const payload: ConsoleProcessState =
      this.activeSession && matchesActive
        ? { ...state, clientTitle: this.activeSession.clientTitle }
        : state;
    this.sendToWindow(IPC_EVENTS.consoleState, payload);
  }

  private ingest(args: {
    source: ConsoleSource;
    raw: string;
    forcedLevel?: ConsoleLevel | undefined;
    key?: CatalogKey | undefined;
    code?: string | undefined;
    args?: ConsoleLineArgs | undefined;
  }): void {
    const { source, raw, forcedLevel, key, code, args: lineArgs } = args;
    if (!raw) return;
    const cleaned = stripAnsi(raw);
    // XMLLayout puts `\n  ` (indent) between events; bare length check would
    // admit the two-space line as a row.
    const segments = cleaned.split(/\r?\n/).filter((segment) => segment.trim().length > 0);
    if (segments.length === 0) return;

    const lines: ConsoleLineInput[] = segments.map((segment) =>
      buildLineInput({
        level: forcedLevel ?? guessLevel(source, segment),
        source,
        message: segment,
        key,
        code,
        args: lineArgs,
      }),
    );
    this.buffer.append(lines);

    if (this.hasWindow()) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = this.buffer.consumePending();
      if (batch.length === 0) return;
      this.sendToWindow(IPC_EVENTS.consoleLines, batch);
    }, FLUSH_INTERVAL_MS);
  }

  // Called on shutdown so the last batch isn't lost between the pending
  // setTimeout and process exit.
  flushPending(): void {
    this.clearFlushTimer();
    const batch = this.buffer.consumePending();
    if (batch.length === 0) return;
    this.sendToWindow(IPC_EVENTS.consoleLines, batch);
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  // Typed to the console.* channels so a wrong channel/payload pairing fails tsc
  // instead of shipping a mismatched wire shape.
  private sendToWindow<E extends ConsoleEventChannel>(
    channel: E,
    payload: IpcEventPayloads[E],
  ): void {
    emit(this.window, channel, payload);
  }
}

export const createConsoleHub = (): ConsoleHub => new ConsoleHub();
