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
import type { ClientSlug } from '@shared/contracts/ids';
import { IPC_EVENTS } from '@shared/ipc';
import type { BrowserWindow } from 'electron';
import { ConsoleBuffer, type ConsoleLineInput } from './consoleBuffer';
import { ConsoleWindowSink } from './consoleWindowSink';
import { type Log4jEvent, Log4jStreamParser, formatLog4jLine, mapLog4jLevel } from './log4jStream';

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

export type SessionInfo = {
  slug: ClientSlug;
  clientTitle: string;
  state: ConsoleProcessState;
};

export class ConsoleHub {
  private readonly buffer = new ConsoleBuffer({ limit: CONSOLE_BUFFER_LIMIT });
  private readonly sink = new ConsoleWindowSink(() => {
    this.clearFlushTimer();
    this.buffer.clearPending();
  });
  private flushTimer: NodeJS.Timeout | null = null;
  private activeSession: SessionInfo | null = null;
  private readonly log4j = new Log4jStreamParser();

  attach(window: BrowserWindow): void {
    this.sink.attach(window);
  }

  hasWindow(): boolean {
    return this.sink.hasWindow();
  }

  getWindow(): BrowserWindow | null {
    return this.sink.getWindow();
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
    slug: ClientSlug,
    stream: typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR,
    text: string,
  ): void {
    for (const chunk of this.log4j.feed(stream, text)) {
      if (chunk.kind === 'text') {
        this.ingest({ source: stream, raw: chunk.text, slug });
      } else {
        this.ingestLog4jEvent(stream, slug, chunk.event);
      }
    }
  }

  private ingestLog4jEvent(
    source: typeof ConsoleSources.STDOUT | typeof ConsoleSources.STDERR,
    slug: ClientSlug,
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
        slug,
      });
    }
  }

  recordSystem(
    message: string,
    options?: { code?: string; args?: ConsoleLineArgs; slug?: ClientSlug },
  ): void {
    this.ingest({
      source: ConsoleSources.SYSTEM,
      raw: message,
      forcedLevel: ConsoleLevels.SYSTEM,
      ...(options?.slug ? { slug: options.slug } : {}),
      ...(options?.code ? { code: options.code } : {}),
      ...(options?.args ? { args: options.args } : {}),
    });
  }

  setActiveSession(session: SessionInfo | null): void {
    // Drain partial XML left from the previous session before the parser is
    // reset; a trailing fragment would otherwise leak into the new session.
    if (this.activeSession) this.drainLog4j(this.activeSession.slug);
    this.clearFlushTimer();
    this.log4j.reset();
    this.activeSession = session;
  }

  // Flush the log4j stream parsers when the game process exits. A FATAL crash
  // event is often split across the final lines and would otherwise be held in
  // the parser buffer until the next session reset — i.e. discarded. Called by
  // the launch flow before emitting the EXITED/CRASHED state so the last event
  // (the most useful for triage) reaches the console.
  endSession(slug: ClientSlug): void {
    this.drainLog4j(slug);
    this.log4j.reset();
  }

  private drainLog4j(slug: ClientSlug): void {
    for (const stream of [ConsoleSources.STDOUT, ConsoleSources.STDERR] as const) {
      for (const chunk of this.log4j.flush(stream)) {
        if (chunk.kind === 'text' && chunk.text.length > 0) {
          this.ingest({ source: stream, raw: chunk.text, slug });
        } else if (chunk.kind === 'event') {
          this.ingestLog4jEvent(stream, slug, chunk.event);
        }
      }
    }
  }

  emitState(state: ConsoleProcessState): void {
    if (this.activeSession && this.activeSession.slug === state.slug) {
      this.activeSession = {
        ...this.activeSession,
        state: { ...state, clientTitle: this.activeSession.clientTitle },
      };
    }
    const payload: ConsoleProcessState = this.activeSession
      ? { ...state, clientTitle: this.activeSession.clientTitle }
      : state;
    this.sendToWindow(IPC_EVENTS.consoleState, payload);
  }

  private ingest(args: {
    source: ConsoleSource;
    raw: string;
    forcedLevel?: ConsoleLevel;
    slug?: ClientSlug;
    code?: string;
    args?: ConsoleLineArgs;
  }): void {
    const { source, raw, forcedLevel, slug, code, args: lineArgs } = args;
    if (!raw) return;
    const cleaned = stripAnsi(raw);
    // XMLLayout puts `\n  ` (indent) between events; bare length check would
    // admit the two-space line as a row.
    const segments = cleaned.split(/\r?\n/).filter((segment) => segment.trim().length > 0);
    if (segments.length === 0) return;

    const lines: ConsoleLineInput[] = segments.map((segment) => {
      const level: ConsoleLevel = forcedLevel ?? guessLevel(source, segment);
      return {
        level,
        source,
        message: segment,
        ...(slug ? { slug } : {}),
        ...(code ? (lineArgs ? { code, args: lineArgs } : { code }) : {}),
      };
    });
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

  // Push any pending lines to the renderer immediately and tear down the flush
  // timer. Called on app shutdown so the last batch isn't lost between the
  // last setTimeout and process exit.
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

  private sendToWindow(channel: string, payload: unknown): void {
    this.sink.send(channel, payload);
  }
}

export const createConsoleHub = (): ConsoleHub => new ConsoleHub();
